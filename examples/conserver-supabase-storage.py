"""
Supabase Storage Backend for Conserver

This module provides a storage backend for the vCon conserver that stores
vCons in Supabase PostgreSQL database. It implements the conserver storage
interface and handles Redis caching automatically.

Installation:
    pip install supabase redis

Usage in config.yml:
    storages:
      supabase:
        module: storage.supabase
        options:
          url: ${SUPABASE_URL}
          anon_key: ${SUPABASE_ANON_KEY}
          # Optional Redis cache configuration
          redis_url: ${REDIS_URL}
          cache_ttl: 3600  # 1 hour in seconds

Configuration:
    - SUPABASE_URL: Your Supabase project URL
    - SUPABASE_ANON_KEY: Your Supabase anon/service role key
    - REDIS_URL: Redis connection URL (optional, for caching)
    - VCON_REDIS_EXPIRY: Cache TTL in seconds (default 3600)
"""

import os
import json
import logging
from typing import Optional, Dict, Any, List
from datetime import datetime

try:
    from supabase import create_client, Client
    SUPABASE_AVAILABLE = True
except ImportError:
    SUPABASE_AVAILABLE = False
    logging.warning("supabase-py not installed. Install with: pip install supabase")

try:
    import redis
    REDIS_AVAILABLE = True
except ImportError:
    REDIS_AVAILABLE = False
    logging.info("redis not installed. Caching disabled. Install with: pip install redis")


class SupabaseStorage:
    """
    Supabase storage backend for conserver.
    
    Stores vCons in Supabase PostgreSQL and optionally caches in Redis.
    Implements write-through cache pattern: writes go to Supabase first,
    then Redis cache for fast reads.
    """
    
    def __init__(self, options: Dict[str, Any]):
        """
        Initialize Supabase storage backend.
        
        Args:
            options: Configuration dict with keys:
                - url: Supabase project URL
                - anon_key: Supabase API key
                - redis_url: Optional Redis URL for caching
                - cache_ttl: Optional cache TTL in seconds (default 3600)
        """
        if not SUPABASE_AVAILABLE:
            raise ImportError("supabase-py is required. Install with: pip install supabase")
        
        self.logger = logging.getLogger(__name__)
        
        # Supabase connection
        url = options.get('url') or os.getenv('SUPABASE_URL')
        key = options.get('anon_key') or os.getenv('SUPABASE_ANON_KEY')
        
        if not url or not key:
            raise ValueError("SUPABASE_URL and SUPABASE_ANON_KEY are required")
        
        self.supabase: Client = create_client(url, key)
        self.logger.info("✅ Connected to Supabase")
        
        # Optional Redis cache
        self.redis_client = None
        self.cache_enabled = False
        self.cache_ttl = int(options.get('cache_ttl', os.getenv('VCON_REDIS_EXPIRY', '3600')))
        
        redis_url = options.get('redis_url') or os.getenv('REDIS_URL')
        if redis_url and REDIS_AVAILABLE:
            try:
                self.redis_client = redis.from_url(
                    redis_url,
                    decode_responses=True,
                    socket_connect_timeout=5,
                    socket_timeout=5
                )
                self.redis_client.ping()
                self.cache_enabled = True
                self.logger.info(f"✅ Redis cache enabled (TTL: {self.cache_ttl}s)")
            except Exception as e:
                self.logger.warning(f"⚠️  Redis connection failed: {e}. Caching disabled.")
                self.redis_client = None
        else:
            self.logger.info("ℹ️  Redis cache disabled (not configured)")
    
    def save(self, vcon: Dict[str, Any]) -> bool:
        """
        Save a vCon to Supabase (and cache in Redis).
        
        Write-through pattern:
        1. Write to Supabase (permanent storage)
        2. Write to Redis (cache)
        3. Return success only if Supabase write succeeds
        
        Args:
            vcon: vCon dictionary
            
        Returns:
            bool: True if save succeeded
        """
        try:
            uuid = vcon.get('uuid')
            if not uuid:
                raise ValueError("vCon must have a uuid field")
            
            # Prepare vCon data for Supabase schema
            vcon_data = {
                'uuid': uuid,
                'vcon_version': vcon.get('vcon', '0.3.0'),
                'subject': vcon.get('subject'),
                'created_at': vcon.get('created_at', datetime.utcnow().isoformat()),
                'updated_at': vcon.get('updated_at', datetime.utcnow().isoformat()),
                'extensions': vcon.get('extensions'),
                'must_support': vcon.get('must_support'),
                'redacted': vcon.get('redacted', {}),
                'appended': vcon.get('appended', {}),
            }
            
            # Insert or update main vCon record
            result = self.supabase.table('vcons').upsert(vcon_data).execute()
            
            if not result.data:
                raise Exception("Failed to save vCon to Supabase")
            
            vcon_id = result.data[0]['id']
            
            # Save parties
            if 'parties' in vcon and vcon['parties']:
                self._save_parties(vcon_id, vcon['parties'])
            
            # Save dialog
            if 'dialog' in vcon and vcon['dialog']:
                self._save_dialog(vcon_id, vcon['dialog'])
            
            # Save analysis
            if 'analysis' in vcon and vcon['analysis']:
                self._save_analysis(vcon_id, vcon['analysis'])
            
            # Save attachments
            if 'attachments' in vcon and vcon['attachments']:
                self._save_attachments(vcon_id, vcon['attachments'])
            
            self.logger.info(f"✅ Saved vCon {uuid} to Supabase")
            
            # Cache in Redis after successful Supabase write
            if self.cache_enabled and self.redis_client:
                try:
                    self.redis_client.setex(
                        f"vcon:{uuid}",
                        self.cache_ttl,
                        json.dumps(vcon)
                    )
                    self.logger.debug(f"✅ Cached vCon {uuid} in Redis")
                except Exception as e:
                    self.logger.warning(f"⚠️  Failed to cache vCon {uuid}: {e}")
                    # Non-fatal: continue without caching
            
            return True
            
        except Exception as e:
            self.logger.error(f"❌ Failed to save vCon: {e}")
            return False
    
    def get(self, uuid: str) -> Optional[Dict[str, Any]]:
        """
        Get a vCon by UUID (cache-first strategy).
        
        Read-through pattern:
        1. Check Redis cache first
        2. If cache miss, fetch from Supabase
        3. Cache the result in Redis
        
        Args:
            uuid: vCon UUID
            
        Returns:
            Dict or None if not found
        """
        # Try cache first
        if self.cache_enabled and self.redis_client:
            try:
                cached = self.redis_client.get(f"vcon:{uuid}")
                if cached:
                    self.logger.debug(f"✅ Cache HIT for vCon {uuid}")
                    return json.loads(cached)
                self.logger.debug(f"ℹ️  Cache MISS for vCon {uuid}")
            except Exception as e:
                self.logger.warning(f"⚠️  Cache read error for {uuid}: {e}")
        
        # Cache miss or cache disabled - fetch from Supabase
        try:
            result = self.supabase.table('vcons').select('*').eq('uuid', uuid).single().execute()
            
            if not result.data:
                return None
            
            vcon_data = result.data
            vcon_id = vcon_data['id']
            
            # Reconstruct full vCon
            vcon = {
                'vcon': vcon_data['vcon_version'],
                'uuid': vcon_data['uuid'],
                'created_at': vcon_data['created_at'],
                'updated_at': vcon_data['updated_at'],
                'subject': vcon_data['subject'],
                'extensions': vcon_data.get('extensions'),
                'must_support': vcon_data.get('must_support'),
                'redacted': vcon_data.get('redacted', {}),
                'appended': vcon_data.get('appended', {}),
            }
            
            # Get related entities
            vcon['parties'] = self._get_parties(vcon_id)
            vcon['dialog'] = self._get_dialog(vcon_id)
            vcon['analysis'] = self._get_analysis(vcon_id)
            vcon['attachments'] = self._get_attachments(vcon_id)
            
            # Cache for future reads
            if self.cache_enabled and self.redis_client:
                try:
                    self.redis_client.setex(
                        f"vcon:{uuid}",
                        self.cache_ttl,
                        json.dumps(vcon)
                    )
                except Exception as e:
                    self.logger.warning(f"⚠️  Failed to cache vCon {uuid}: {e}")
            
            return vcon
            
        except Exception as e:
            self.logger.error(f"❌ Failed to get vCon {uuid}: {e}")
            return None
    
    def delete(self, uuid: str) -> bool:
        """
        Delete a vCon from Supabase and cache.
        
        Args:
            uuid: vCon UUID
            
        Returns:
            bool: True if delete succeeded
        """
        try:
            # Delete from Supabase (cascades to related tables)
            self.supabase.table('vcons').delete().eq('uuid', uuid).execute()
            
            # Invalidate cache
            if self.cache_enabled and self.redis_client:
                try:
                    self.redis_client.delete(f"vcon:{uuid}")
                except Exception as e:
                    self.logger.warning(f"⚠️  Failed to invalidate cache for {uuid}: {e}")
            
            self.logger.info(f"✅ Deleted vCon {uuid}")
            return True
            
        except Exception as e:
            self.logger.error(f"❌ Failed to delete vCon {uuid}: {e}")
            return False
    
    def search(self, query: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Search vCons by criteria.
        
        Args:
            query: Search criteria dict
            
        Returns:
            List of matching vCons
        """
        try:
            table = self.supabase.table('vcons')
            
            # Apply filters
            if 'subject' in query:
                table = table.ilike('subject', f"%{query['subject']}%")
            
            if 'start_date' in query:
                table = table.gte('created_at', query['start_date'])
            
            if 'end_date' in query:
                table = table.lte('created_at', query['end_date'])
            
            result = table.select('uuid').execute()
            
            # Fetch full vCons
            vcons = []
            for row in result.data:
                vcon = self.get(row['uuid'])
                if vcon:
                    vcons.append(vcon)
            
            return vcons
            
        except Exception as e:
            self.logger.error(f"❌ Search failed: {e}")
            return []
    
    # Helper methods for saving related entities
    
    def _save_parties(self, vcon_id: str, parties: List[Dict[str, Any]]):
        """Save parties to database."""
        for idx, party in enumerate(parties):
            party_data = {
                'vcon_id': vcon_id,
                'party_index': idx,
                'tel': party.get('tel'),
                'sip': party.get('sip'),
                'stir': party.get('stir'),
                'mailto': party.get('mailto'),
                'name': party.get('name'),
                'did': party.get('did'),
                'uuid': party.get('uuid'),
                'validation': party.get('validation'),
                'jcard': party.get('jcard'),
                'gmlpos': party.get('gmlpos'),
                'civicaddress': party.get('civicaddress'),
                'timezone': party.get('timezone'),
            }
            self.supabase.table('parties').upsert(party_data).execute()
    
    def _save_dialog(self, vcon_id: str, dialogs: List[Dict[str, Any]]):
        """Save dialog to database."""
        for idx, dialog in enumerate(dialogs):
            dialog_data = {
                'vcon_id': vcon_id,
                'dialog_index': idx,
                'type': dialog.get('type'),
                'start_time': dialog.get('start'),
                'duration_seconds': dialog.get('duration'),
                'parties': dialog.get('parties'),
                'originator': dialog.get('originator'),
                'mediatype': dialog.get('mediatype'),
                'filename': dialog.get('filename'),
                'body': dialog.get('body'),
                'encoding': dialog.get('encoding'),
                'url': dialog.get('url'),
                'content_hash': dialog.get('content_hash'),
                'disposition': dialog.get('disposition'),
                'session_id': dialog.get('session_id'),
                'application': dialog.get('application'),
                'message_id': dialog.get('message_id'),
            }
            self.supabase.table('dialog').upsert(dialog_data).execute()
    
    def _save_analysis(self, vcon_id: str, analyses: List[Dict[str, Any]]):
        """Save analysis to database."""
        for idx, analysis in enumerate(analyses):
            # Normalize dialog field to array
            dialog_indices = analysis.get('dialog')
            if dialog_indices is not None and not isinstance(dialog_indices, list):
                dialog_indices = [dialog_indices]
            
            analysis_data = {
                'vcon_id': vcon_id,
                'analysis_index': idx,
                'type': analysis.get('type'),
                'dialog_indices': dialog_indices,
                'mediatype': analysis.get('mediatype'),
                'filename': analysis.get('filename'),
                'vendor': analysis.get('vendor'),
                'product': analysis.get('product'),
                'schema': analysis.get('schema'),
                'body': analysis.get('body'),
                'encoding': analysis.get('encoding'),
                'url': analysis.get('url'),
                'content_hash': analysis.get('content_hash'),
            }
            self.supabase.table('analysis').upsert(analysis_data).execute()
    
    def _save_attachments(self, vcon_id: str, attachments: List[Dict[str, Any]]):
        """Save attachments to database."""
        for idx, attachment in enumerate(attachments):
            attachment_data = {
                'vcon_id': vcon_id,
                'attachment_index': idx,
                'type': attachment.get('type'),
                'start_time': attachment.get('start'),
                'party': attachment.get('party'),
                'dialog': attachment.get('dialog'),
                'mimetype': attachment.get('mediatype'),
                'filename': attachment.get('filename'),
                'body': attachment.get('body'),
                'encoding': attachment.get('encoding'),
                'url': attachment.get('url'),
                'content_hash': attachment.get('content_hash'),
            }
            self.supabase.table('attachments').upsert(attachment_data).execute()
    
    # Helper methods for getting related entities
    
    def _get_parties(self, vcon_id: str) -> List[Dict[str, Any]]:
        """Get parties from database."""
        result = self.supabase.table('parties').select('*').eq('vcon_id', vcon_id).order('party_index').execute()
        return [self._party_from_db(p) for p in result.data]
    
    def _get_dialog(self, vcon_id: str) -> List[Dict[str, Any]]:
        """Get dialog from database."""
        result = self.supabase.table('dialog').select('*').eq('vcon_id', vcon_id).order('dialog_index').execute()
        return [self._dialog_from_db(d) for d in result.data]
    
    def _get_analysis(self, vcon_id: str) -> List[Dict[str, Any]]:
        """Get analysis from database."""
        result = self.supabase.table('analysis').select('*').eq('vcon_id', vcon_id).order('analysis_index').execute()
        return [self._analysis_from_db(a) for a in result.data]
    
    def _get_attachments(self, vcon_id: str) -> List[Dict[str, Any]]:
        """Get attachments from database."""
        result = self.supabase.table('attachments').select('*').eq('vcon_id', vcon_id).order('attachment_index').execute()
        return [self._attachment_from_db(a) for a in result.data]
    
    @staticmethod
    def _party_from_db(row: Dict[str, Any]) -> Dict[str, Any]:
        """Convert database row to party dict."""
        party = {}
        if row.get('tel'): party['tel'] = row['tel']
        if row.get('sip'): party['sip'] = row['sip']
        if row.get('stir'): party['stir'] = row['stir']
        if row.get('mailto'): party['mailto'] = row['mailto']
        if row.get('name'): party['name'] = row['name']
        if row.get('did'): party['did'] = row['did']
        if row.get('uuid'): party['uuid'] = row['uuid']
        if row.get('validation'): party['validation'] = row['validation']
        if row.get('jcard'): party['jcard'] = row['jcard']
        if row.get('gmlpos'): party['gmlpos'] = row['gmlpos']
        if row.get('civicaddress'): party['civicaddress'] = row['civicaddress']
        if row.get('timezone'): party['timezone'] = row['timezone']
        return party
    
    @staticmethod
    def _dialog_from_db(row: Dict[str, Any]) -> Dict[str, Any]:
        """Convert database row to dialog dict."""
        dialog = {'type': row['type']}
        if row.get('start_time'): dialog['start'] = row['start_time']
        if row.get('duration_seconds') is not None: dialog['duration'] = row['duration_seconds']
        if row.get('parties'): dialog['parties'] = row['parties']
        if row.get('originator') is not None: dialog['originator'] = row['originator']
        if row.get('mediatype'): dialog['mediatype'] = row['mediatype']
        if row.get('filename'): dialog['filename'] = row['filename']
        if row.get('body'): dialog['body'] = row['body']
        if row.get('encoding'): dialog['encoding'] = row['encoding']
        if row.get('url'): dialog['url'] = row['url']
        if row.get('content_hash'): dialog['content_hash'] = row['content_hash']
        if row.get('disposition'): dialog['disposition'] = row['disposition']
        if row.get('session_id'): dialog['session_id'] = row['session_id']
        if row.get('application'): dialog['application'] = row['application']
        if row.get('message_id'): dialog['message_id'] = row['message_id']
        return dialog
    
    @staticmethod
    def _analysis_from_db(row: Dict[str, Any]) -> Dict[str, Any]:
        """Convert database row to analysis dict."""
        analysis = {
            'type': row['type'],
            'vendor': row['vendor']
        }
        
        # Handle dialog indices (might be single value or array)
        if row.get('dialog_indices'):
            indices = row['dialog_indices']
            analysis['dialog'] = indices[0] if len(indices) == 1 else indices
        
        if row.get('mediatype'): analysis['mediatype'] = row['mediatype']
        if row.get('filename'): analysis['filename'] = row['filename']
        if row.get('product'): analysis['product'] = row['product']
        if row.get('schema'): analysis['schema'] = row['schema']
        if row.get('body'): analysis['body'] = row['body']
        if row.get('encoding'): analysis['encoding'] = row['encoding']
        if row.get('url'): analysis['url'] = row['url']
        if row.get('content_hash'): analysis['content_hash'] = row['content_hash']
        return analysis
    
    @staticmethod
    def _attachment_from_db(row: Dict[str, Any]) -> Dict[str, Any]:
        """Convert database row to attachment dict."""
        attachment = {}
        if row.get('type'): attachment['type'] = row['type']
        if row.get('start_time'): attachment['start'] = row['start_time']
        if row.get('party') is not None: attachment['party'] = row['party']
        if row.get('dialog') is not None: attachment['dialog'] = row['dialog']
        if row.get('mimetype'): attachment['mediatype'] = row['mimetype']
        if row.get('filename'): attachment['filename'] = row['filename']
        if row.get('body'): attachment['body'] = row['body']
        if row.get('encoding'): attachment['encoding'] = row['encoding']
        if row.get('url'): attachment['url'] = row['url']
        if row.get('content_hash'): attachment['content_hash'] = row['content_hash']
        return attachment


