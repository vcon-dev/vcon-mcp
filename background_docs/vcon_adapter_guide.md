# vCon Adapter Development Guide

A comprehensive guide for building adapters that convert conversation data from various systems into the standardized vCon format using the vCon Python library.

## Table of Contents

1. [Introduction to vCon Adapters](#introduction-to-vcon-adapters)
2. [Adapter Architecture](#adapter-architecture)
3. [Getting Started](#getting-started)
4. [Core Adapter Components](#core-adapter-components)
5. [Data Mapping Strategies](#data-mapping-strategies)
6. [Media Handling](#media-handling)
7. [Best Practices](#best-practices)
8. [Testing Your Adapter](#testing-your-adapter)
9. [Common Patterns](#common-patterns)
10. [Troubleshooting](#troubleshooting)

## Introduction to vCon Adapters

vCon adapters are specialized components that transform conversation data from various sources (call centers, chat systems, video conferencing platforms, etc.) into the standardized vCon format. This enables interoperability between different conversation systems and provides a unified way to store, analyze, and exchange conversation data.

### What vCon Adapters Do

- **Extract** conversation data from source systems
- **Transform** data into vCon-compliant structures
- **Validate** the resulting vCon objects
- **Export** vCons for storage or further processing

### Common Use Cases

- **Call Center Integration**: Convert PBX call records to vCons
- **Chat Platform Export**: Transform Slack/Teams conversations
- **Video Conference Processing**: Convert Zoom/WebEx recordings
- **Email Threading**: Convert email chains to conversation format
- **Social Media Monitoring**: Transform social interactions

## Adapter Architecture

### Basic Adapter Structure

```python
from abc import ABC, abstractmethod
from typing import Dict, List, Any, Optional
from vcon import Vcon, Party, Dialog
from datetime import datetime

class BaseVconAdapter(ABC):
    """Base class for all vCon adapters."""
    
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.validation_errors = []
    
    @abstractmethod
    def extract_data(self, source: Any) -> Dict[str, Any]:
        """Extract raw data from the source system."""
        pass
    
    @abstractmethod
    def transform_to_vcon(self, raw_data: Dict[str, Any]) -> Vcon:
        """Transform raw data into a vCon object."""
        pass
    
    def validate_vcon(self, vcon: Vcon) -> bool:
        """Validate the generated vCon."""
        is_valid, errors = vcon.is_valid()
        self.validation_errors = errors
        return is_valid
    
    def process(self, source: Any) -> Vcon:
        """Main processing pipeline."""
        raw_data = self.extract_data(source)
        vcon = self.transform_to_vcon(raw_data)
        
        if not self.validate_vcon(vcon):
            raise ValueError(f"Invalid vCon generated: {self.validation_errors}")
        
        return vcon
```

### Modular Design Pattern

```python
class VconAdapterPipeline:
    """Pipeline for processing conversation data through multiple stages."""
    
    def __init__(self):
        self.extractors = []
        self.transformers = []
        self.validators = []
        self.exporters = []
    
    def add_extractor(self, extractor):
        self.extractors.append(extractor)
    
    def add_transformer(self, transformer):
        self.transformers.append(transformer)
    
    def process_conversation(self, source_data):
        # Extract
        for extractor in self.extractors:
            source_data = extractor.process(source_data)
        
        # Transform
        vcon = Vcon.build_new()
        for transformer in self.transformers:
            vcon = transformer.apply(vcon, source_data)
        
        # Validate
        for validator in self.validators:
            validator.validate(vcon)
        
        return vcon
```

## Getting Started

### Installation and Setup

```python
# Install the vCon library
pip install vcon

# Basic adapter setup
from vcon import Vcon, Party, Dialog
import json
from datetime import datetime
```

### Simple Adapter Example

```python
class ChatLogAdapter(BaseVconAdapter):
    """Adapter for converting chat logs to vCon format."""
    
    def extract_data(self, chat_file_path: str) -> Dict[str, Any]:
        """Extract data from a chat log file."""
        with open(chat_file_path, 'r') as f:
            return json.load(f)
    
    def transform_to_vcon(self, raw_data: Dict[str, Any]) -> Vcon:
        """Transform chat data to vCon."""
        vcon = Vcon.build_new()
        
        # Add metadata
        vcon.add_tag("source", "chat_log")
        vcon.add_tag("platform", raw_data.get("platform", "unknown"))
        
        # Process participants
        participant_map = {}
        for i, participant in enumerate(raw_data.get("participants", [])):
            party = Party(
                name=participant["name"],
                mailto=participant.get("email"),
                role=participant.get("role", "participant")
            )
            vcon.add_party(party)
            participant_map[participant["id"]] = i
        
        # Process messages
        for message in raw_data.get("messages", []):
            dialog = Dialog(
                type="text",
                start=datetime.fromisoformat(message["timestamp"]),
                parties=[participant_map[message["sender_id"]]],
                originator=participant_map[message["sender_id"]],
                mimetype="text/plain",
                body=message["content"]
            )
            vcon.add_dialog(dialog)
        
        return vcon

# Usage
adapter = ChatLogAdapter({})
vcon = adapter.process("chat_log.json")
vcon.save_to_file("conversation.vcon.json")
```

## Core Adapter Components

### 1. Data Extractors

```python
class CallRecordExtractor:
    """Extract data from call center records."""
    
    def __init__(self, api_client):
        self.api_client = api_client
    
    def extract_call_data(self, call_id: str) -> Dict[str, Any]:
        """Extract call data from the system."""
        call_record = self.api_client.get_call(call_id)
        recording_url = self.api_client.get_recording_url(call_id)
        transcript = self.api_client.get_transcript(call_id)
        
        return {
            "call_record": call_record,
            "recording_url": recording_url,
            "transcript": transcript,
            "metadata": self.api_client.get_call_metadata(call_id)
        }

class EmailThreadExtractor:
    """Extract data from email threads."""
    
    def extract_thread(self, thread_id: str) -> Dict[str, Any]:
        """Extract email thread data."""
        # Implementation for email extraction
        pass
```

### 2. Party Mappers

```python
class PartyMapper:
    """Maps source system participants to vCon parties."""
    
    def __init__(self, mapping_rules: Dict[str, str]):
        self.mapping_rules = mapping_rules
    
    def map_party(self, source_participant: Dict[str, Any]) -> Party:
        """Map a source participant to a vCon Party."""
        return Party(
            name=source_participant.get(self.mapping_rules.get("name", "name")),
            tel=source_participant.get(self.mapping_rules.get("phone", "phone")),
            mailto=source_participant.get(self.mapping_rules.get("email", "email")),
            role=self.determine_role(source_participant),
            uuid=source_participant.get("id")
        )
    
    def determine_role(self, participant: Dict[str, Any]) -> str:
        """Determine the role of a participant."""
        if participant.get("is_agent"):
            return "agent"
        elif participant.get("is_customer"):
            return "customer"
        else:
            return "participant"
```

### 3. Dialog Processors

```python
class DialogProcessor:
    """Process different types of dialog content."""
    
    def process_text_message(self, message: Dict[str, Any], parties_map: Dict) -> Dialog:
        """Process a text message into a Dialog."""
        return Dialog(
            type="text",
            start=self.parse_timestamp(message["timestamp"]),
            parties=self.get_involved_parties(message, parties_map),
            originator=parties_map[message["sender_id"]],
            mimetype="text/plain",
            body=message["content"]
        )
    
    def process_audio_recording(self, recording: Dict[str, Any], parties_map: Dict) -> Dialog:
        """Process an audio recording into a Dialog."""
        return Dialog(
            type="recording",
            start=self.parse_timestamp(recording["start_time"]),
            parties=list(parties_map.values()),
            mimetype="audio/wav",
            url=recording["url"],
            duration=recording.get("duration")
        )
    
    def process_video_call(self, video_data: Dict[str, Any], parties_map: Dict) -> Dialog:
        """Process a video call into a Dialog."""
        return Dialog(
            type="video",
            start=self.parse_timestamp(video_data["start_time"]),
            parties=list(parties_map.values()),
            mimetype="video/mp4",
            url=video_data["recording_url"],
            resolution=video_data.get("resolution", "1920x1080"),
            duration=video_data.get("duration")
        )
```

## Data Mapping Strategies

### 1. Configuration-Driven Mapping

```python
class ConfigurableMappingAdapter(BaseVconAdapter):
    """Adapter with configurable field mappings."""
    
    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.field_mappings = config.get("field_mappings", {})
        self.party_mappings = config.get("party_mappings", {})
        self.dialog_mappings = config.get("dialog_mappings", {})
    
    def map_field(self, source_data: Dict, mapping_path: str, default=None):
        """Map a field from source data using configured path."""
        keys = mapping_path.split(".")
        value = source_data
        
        try:
            for key in keys:
                value = value[key]
            return value
        except (KeyError, TypeError):
            return default

# Configuration example
mapping_config = {
    "field_mappings": {
        "conversation_id": "call.id",
        "start_time": "call.started_at",
        "end_time": "call.ended_at"
    },
    "party_mappings": {
        "name": "participant.display_name",
        "phone": "participant.phone_number",
        "email": "participant.email_address"
    },
    "dialog_mappings": {
        "timestamp": "message.created_at",
        "content": "message.body",
        "sender": "message.from"
    }
}
```

### 2. Schema-Based Transformation

```python
from jsonschema import validate

class SchemaBasedAdapter(BaseVconAdapter):
    """Adapter that validates input against a schema before transformation."""
    
    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.input_schema = config["input_schema"]
        self.transformation_rules = config["transformation_rules"]
    
    def extract_data(self, source: Dict[str, Any]) -> Dict[str, Any]:
        """Extract and validate data against schema."""
        validate(source, self.input_schema)
        return source
    
    def apply_transformation_rules(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Apply transformation rules to normalize data."""
        transformed = {}
        
        for target_field, rule in self.transformation_rules.items():
            if rule["type"] == "direct_map":
                transformed[target_field] = data.get(rule["source_field"])
            elif rule["type"] == "function":
                transformed[target_field] = self.apply_function(
                    rule["function"], 
                    data.get(rule["source_field"])
                )
        
        return transformed
```

## Media Handling

### 1. Audio Processing

```python
class AudioMediaHandler:
    """Handle audio content in conversations."""
    
    def process_audio_dialog(self, audio_data: Dict[str, Any]) -> Dialog:
        """Process audio data into a vCon dialog."""
        if audio_data.get("is_external"):
            return self.create_external_audio_dialog(audio_data)
        else:
            return self.create_inline_audio_dialog(audio_data)
    
    def create_external_audio_dialog(self, audio_data: Dict[str, Any]) -> Dialog:
        """Create dialog with external audio reference."""
        return Dialog(
            type="recording",
            start=audio_data["start_time"],
            parties=audio_data["participants"],
            mimetype=self.detect_audio_mimetype(audio_data["url"]),
            url=audio_data["url"],
            duration=audio_data.get("duration"),
            content_hash=audio_data.get("checksum")
        )
    
    def create_inline_audio_dialog(self, audio_data: Dict[str, Any]) -> Dialog:
        """Create dialog with inline audio data."""
        import base64
        
        # Read audio file and encode
        with open(audio_data["file_path"], "rb") as f:
            audio_bytes = f.read()
        
        encoded_audio = base64.b64encode(audio_bytes).decode()
        
        return Dialog(
            type="recording",
            start=audio_data["start_time"],
            parties=audio_data["participants"],
            mimetype=self.detect_audio_mimetype(audio_data["file_path"]),
            body=encoded_audio,
            encoding="base64",
            filename=audio_data.get("filename")
        )
```

### 2. Video Processing

```python
class VideoMediaHandler:
    """Handle video content in conversations."""
    
    def process_video_call(self, video_data: Dict[str, Any]) -> Dialog:
        """Process video call data."""
        dialog = Dialog(
            type="video",
            start=video_data["start_time"],
            parties=video_data["participants"],
            mimetype="video/mp4",
            url=video_data["recording_url"],
            resolution=video_data.get("resolution"),
            frame_rate=video_data.get("fps"),
            codec=video_data.get("codec")
        )
        
        # Add video metadata
        if video_data.get("has_screen_share"):
            dialog.metadata = dialog.metadata or {}
            dialog.metadata["screen_share"] = True
        
        return dialog
    
    def generate_thumbnail(self, video_dialog: Dialog) -> str:
        """Generate thumbnail for video dialog."""
        if hasattr(video_dialog, 'generate_thumbnail'):
            thumbnail_data = video_dialog.generate_thumbnail(
                timestamp=5.0,  # 5 seconds into video
                width=320,
                height=240
            )
            return base64.b64encode(thumbnail_data).decode()
        return None
```

## Best Practices

### 1. Error Handling and Resilience

```python
class ResilientAdapter(BaseVconAdapter):
    """Adapter with comprehensive error handling."""
    
    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.retry_attempts = config.get("retry_attempts", 3)
        self.error_handlers = {}
    
    def register_error_handler(self, error_type: type, handler):
        """Register custom error handlers."""
        self.error_handlers[error_type] = handler
    
    def safe_extract_data(self, source: Any) -> Dict[str, Any]:
        """Extract data with error handling and retries."""
        for attempt in range(self.retry_attempts):
            try:
                return self.extract_data(source)
            except Exception as e:
                if type(e) in self.error_handlers:
                    return self.error_handlers[type(e)](source, e, attempt)
                
                if attempt == self.retry_attempts - 1:
                    raise
                
                # Exponential backoff
                time.sleep(2 ** attempt)
    
    def partial_transform_with_fallbacks(self, raw_data: Dict[str, Any]) -> Vcon:
        """Transform data with fallbacks for missing fields."""
        vcon = Vcon.build_new()
        
        try:
            # Attempt full transformation
            return self.transform_to_vcon(raw_data)
        except Exception as e:
            # Fall back to partial transformation
            return self.create_minimal_vcon(raw_data, e)
    
    def create_minimal_vcon(self, raw_data: Dict[str, Any], error: Exception) -> Vcon:
        """Create minimal vCon when full transformation fails."""
        vcon = Vcon.build_new()
        
        # Add error information
        vcon.add_tag("transformation_error", str(error))
        vcon.add_tag("partial_conversion", "true")
        
        # Add raw data as attachment if possible
        try:
            vcon.add_attachment(
                type="raw_source_data",
                body=json.dumps(raw_data),
                encoding="json"
            )
        except:
            pass  # Silently fail if raw data can't be serialized
        
        return vcon
```

### 2. Performance Optimization

```python
class PerformantAdapter(BaseVconAdapter):
    """Adapter optimized for performance."""
    
    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.batch_size = config.get("batch_size", 100)
        self.use_threading = config.get("use_threading", False)
        self.cache_enabled = config.get("cache_enabled", True)
        self._cache = {} if self.cache_enabled else None
    
    def process_batch(self, sources: List[Any]) -> List[Vcon]:
        """Process multiple conversations in batch."""
        if self.use_threading:
            return self._process_threaded_batch(sources)
        else:
            return [self.process(source) for source in sources]
    
    def _process_threaded_batch(self, sources: List[Any]) -> List[Vcon]:
        """Process batch using threading for I/O bound operations."""
        from concurrent.futures import ThreadPoolExecutor, as_completed
        
        vcons = []
        with ThreadPoolExecutor(max_workers=5) as executor:
            future_to_source = {
                executor.submit(self.process, source): source 
                for source in sources
            }
            
            for future in as_completed(future_to_source):
                try:
                    vcon = future.result()
                    vcons.append(vcon)
                except Exception as e:
                    source = future_to_source[future]
                    print(f"Error processing {source}: {e}")
        
        return vcons
    
    def cached_lookup(self, key: str, fetch_func):
        """Cache expensive lookups."""
        if not self.cache_enabled:
            return fetch_func()
        
        if key not in self._cache:
            self._cache[key] = fetch_func()
        
        return self._cache[key]
```

### 3. Logging and Monitoring

```python
import logging
from datetime import datetime

class MonitoredAdapter(BaseVconAdapter):
    """Adapter with comprehensive logging and monitoring."""
    
    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.logger = logging.getLogger(f"{self.__class__.__name__}")
        self.metrics = {
            "processed_count": 0,
            "error_count": 0,
            "start_time": datetime.now()
        }
    
    def process(self, source: Any) -> Vcon:
        """Process with monitoring."""
        start_time = datetime.now()
        
        try:
            self.logger.info(f"Starting processing for source: {source}")
            vcon = super().process(source)
            
            # Update metrics
            self.metrics["processed_count"] += 1
            processing_time = (datetime.now() - start_time).total_seconds()
            
            self.logger.info(
                f"Successfully processed source in {processing_time:.2f}s"
            )
            
            return vcon
            
        except Exception as e:
            self.metrics["error_count"] += 1
            self.logger.error(f"Failed to process source: {e}", exc_info=True)
            raise
    
    def get_metrics(self) -> Dict[str, Any]:
        """Get adapter performance metrics."""
        runtime = (datetime.now() - self.metrics["start_time"]).total_seconds()
        
        return {
            **self.metrics,
            "runtime_seconds": runtime,
            "success_rate": (
                self.metrics["processed_count"] / 
                (self.metrics["processed_count"] + self.metrics["error_count"])
                if (self.metrics["processed_count"] + self.metrics["error_count"]) > 0
                else 0
            )
        }
```

## Testing Your Adapter

### 1. Unit Testing Framework

```python
import unittest
from unittest.mock import Mock, patch
import tempfile
import json

class TestChatLogAdapter(unittest.TestCase):
    """Test suite for ChatLogAdapter."""
    
    def setUp(self):
        """Set up test fixtures."""
        self.adapter = ChatLogAdapter({})
        
        self.sample_data = {
            "platform": "slack",
            "participants": [
                {"id": "user1", "name": "Alice", "email": "alice@example.com"},
                {"id": "user2", "name": "Bob", "email": "bob@example.com"}
            ],
            "messages": [
                {
                    "sender_id": "user1",
                    "timestamp": "2023-01-01T10:00:00Z",
                    "content": "Hello!"
                },
                {
                    "sender_id": "user2",
                    "timestamp": "2023-01-01T10:01:00Z",
                    "content": "Hi there!"
                }
            ]
        }
    
    def test_extract_data(self):
        """Test data extraction from file."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump(self.sample_data, f)
            temp_path = f.name
        
        try:
            extracted = self.adapter.extract_data(temp_path)
            self.assertEqual(extracted, self.sample_data)
        finally:
            os.unlink(temp_path)
    
    def test_transform_to_vcon(self):
        """Test transformation to vCon format."""
        vcon = self.adapter.transform_to_vcon(self.sample_data)
        
        # Verify basic structure
        self.assertEqual(len(vcon.parties), 2)
        self.assertEqual(len(vcon.dialog), 2)
        
        # Verify parties
        self.assertEqual(vcon.parties[0].name, "Alice")
        self.assertEqual(vcon.parties[1].name, "Bob")
        
        # Verify dialogs
        self.assertEqual(vcon.dialog[0]["type"], "text")
        self.assertEqual(vcon.dialog[0]["body"], "Hello!")
    
    def test_invalid_data_handling(self):
        """Test handling of invalid input data."""
        invalid_data = {"invalid": "structure"}
        
        with self.assertRaises(KeyError):
            self.adapter.transform_to_vcon(invalid_data)
    
    def test_vcon_validation(self):
        """Test that generated vCons are valid."""
        vcon = self.adapter.transform_to_vcon(self.sample_data)
        is_valid, errors = vcon.is_valid()
        
        self.assertTrue(is_valid, f"vCon validation failed: {errors}")

class TestAdapterIntegration(unittest.TestCase):
    """Integration tests for adapter functionality."""
    
    def test_end_to_end_processing(self):
        """Test complete processing pipeline."""
        # Create test data
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump(sample_chat_data, f)
            input_path = f.name
        
        try:
            # Process through adapter
            adapter = ChatLogAdapter({})
            vcon = adapter.process(input_path)
            
            # Save and reload to test serialization
            with tempfile.NamedTemporaryFile(mode='w', suffix='.vcon.json', delete=False) as f:
                output_path = f.name
            
            vcon.save_to_file(output_path)
            reloaded_vcon = Vcon.load_from_file(output_path)
            
            # Verify roundtrip
            self.assertEqual(vcon.to_json(), reloaded_vcon.to_json())
            
        finally:
            os.unlink(input_path)
            os.unlink(output_path)
```

### 2. Property-Based Testing

```python
from hypothesis import given, strategies as st

class TestAdapterProperties(unittest.TestCase):
    """Property-based tests for adapter behavior."""
    
    @given(st.dictionaries(
        st.text(min_size=1),
        st.one_of(st.text(), st.integers(), st.floats()),
        min_size=1
    ))
    def test_adapter_handles_arbitrary_metadata(self, metadata):
        """Test that adapter handles arbitrary metadata gracefully."""
        adapter = MetadataAdapter({})
        
        try:
            # Should not crash on arbitrary input
            result = adapter.process_metadata(metadata)
            # Result should be valid JSON serializable
            json.dumps(result)
        except Exception as e:
            # If it fails, it should fail gracefully
            self.assertIsInstance(e, (ValueError, TypeError))
    
    @given(st.lists(
        st.dictionaries(
            st.sampled_from(["name", "email", "phone"]),
            st.text(min_size=1),
            min_size=1
        ),
        min_size=1,
        max_size=10
    ))
    def test_party_mapping_preserves_count(self, participants):
        """Test that party mapping preserves participant count."""
        adapter = PartyMappingAdapter({})
        mapped_parties = adapter.map_participants(participants)
        
        self.assertEqual(len(participants), len(mapped_parties))
```

## Common Patterns

### 1. Multi-Source Adapter

```python
class MultiSourceAdapter:
    """Adapter that combines data from multiple sources."""
    
    def __init__(self, source_adapters: Dict[str, BaseVconAdapter]):
        self.source_adapters = source_adapters
    
    def process_combined(self, sources: Dict[str, Any]) -> Vcon:
        """Process data from multiple sources into a single vCon."""
        base_vcon = Vcon.build_new()
        
        # Process each source
        for source_name, source_data in sources.items():
            adapter = self.source_adapters[source_name]
            source_vcon = adapter.process(source_data)
            
            # Merge into base vCon
            base_vcon = self.merge_vcons(base_vcon, source_vcon, source_name)
        
        return base_vcon
    
    def merge_vcons(self, base: Vcon, source: Vcon, source_name: str) -> Vcon:
        """Merge source vCon into base vCon."""
        # Merge parties (avoiding duplicates)
        party_offset = len(base.parties)
        for party in source.parties:
            base.add_party(party)
        
        # Merge dialogs (adjusting party references)
        for dialog_dict in source.dialog:
            # Adjust party references
            if "parties" in dialog_dict:
                dialog_dict["parties"] = [
                    p + party_offset for p in dialog_dict["parties"]
                ]
            if "originator" in dialog_dict:
                dialog_dict["originator"] += party_offset
            
            # Add source tag
            dialog = Dialog(**dialog_dict)
            dialog.metadata = dialog.metadata or {}
            dialog.metadata["source"] = source_name
            
            base.add_dialog(dialog)
        
        return base
```

### 2. Streaming Adapter

```python
class StreamingAdapter:
    """Adapter for processing streaming conversation data."""
    
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.conversation_buffer = {}
        self.buffer_timeout = config.get("buffer_timeout", 300)  # 5 minutes
    
    def process_stream_event(self, event: Dict[str, Any]) -> Optional[Vcon]:
        """Process a single streaming event."""
        conversation_id = event.get("conversation_id")
        
        if conversation_id not in self.conversation_buffer:
            self.conversation_buffer[conversation_id] = {
                "events": [],
                "last_updated": datetime.now()
            }
        
        # Add event to buffer
        self.conversation_buffer[conversation_id]["events"].append(event)
        self.conversation_buffer[conversation_id]["last_updated"] = datetime.now()
        
        # Check if conversation is complete
        if self.is_conversation_complete(conversation_id, event):
            return self.finalize_conversation(conversation_id)
        
        return None
    
    def is_conversation_complete(self, conversation_id: str, event: Dict[str, Any]) -> bool:
        """Determine if a conversation is complete."""
        return event.get("type") == "conversation_ended"
    
    def finalize_conversation(self, conversation_id: str) -> Vcon:
        """Convert buffered events to a vCon."""
        events = self.conversation_buffer[conversation_id]["events"]
        
        # Build vCon from events
        vcon = Vcon.build_new()
        vcon.add_tag("conversation_id", conversation_id)
        
        # Process events in chronological order
        for event in sorted(events, key=lambda e: e.get("timestamp", "")):
            self.process_event_to_vcon(vcon, event)
        
        # Clean up buffer
        del self.conversation_buffer[conversation_id]
        
        return vcon
    
    def cleanup_stale_conversations(self):
        """Clean up conversations that have been buffered too long."""
        now = datetime.now()
        stale_conversations = [
            conv_id for conv_id, data in self.conversation_buffer.items()
            if (now - data["last_updated"]).seconds > self.buffer_timeout
        ]
        
        for conv_id in stale_conversations:
            # Force finalize stale conversations
            self.finalize_conversation(conv_id)
```

### 3. Incremental Adapter

```python
class IncrementalAdapter:
    """Adapter that processes conversations incrementally."""
    
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.checkpoint_manager = CheckpointManager(config.get("checkpoint_file"))
    
    def process_incremental(self, source_iterator) -> Iterator[Vcon]:
        """Process conversations incrementally with checkpointing."""
        last_checkpoint = self.checkpoint_manager.get_last_checkpoint()
        
        for item in source_iterator:
            # Skip items already processed
            if self.is_before_checkpoint(item, last_checkpoint):
                continue
            
            try:
                vcon = self.process_item(item)
                yield vcon
                
                # Update checkpoint
                self.checkpoint_manager.update_checkpoint(
                    self.get_item_checkpoint(item)
                )
                
            except Exception as e:
                # Log error and continue
                self.handle_processing_error(item, e)
    
    def process_item(self, item: Any) -> Vcon:
        """Process a single item to vCon."""
        # Implementation specific to source format
        pass
    
    def is_before_checkpoint(self, item: Any, checkpoint: Any) -> bool:
        """Check if item was processed in previous run."""
        # Implementation specific to source format
        pass

class CheckpointManager:
    """Manage processing checkpoints for incremental processing."""
    
    def __init__(self, checkpoint_file: str):
        self.checkpoint_file = checkpoint_file
    
    def get_last_checkpoint(self) -> Any:
        """Get the last processing checkpoint."""
        try:
            with open(self.checkpoint_file, 'r') as f:
                return json.load(f)
        except FileNotFoundError:
            return None
    
    def update_checkpoint(self, checkpoint: Any):
        """Update the processing checkpoint."""
        with open(self.checkpoint_file, 'w') as f:
            json.dump(checkpoint, f)
```

## Troubleshooting

### Common Issues and Solutions

#### 1. Invalid vCon Generation

**Problem**: Generated vCons fail validation

**Solutions**:
```python
def debug_vcon_validation(vcon: Vcon):
    """Debug vCon validation issues."""
    is_valid, errors = vcon.is_valid()
    
    if not is_valid:
        print("Validation errors:")
        for error in errors:
            print(f"  - {error}")
        
        # Check specific common issues
        if not vcon.parties:
            print("  Issue: No parties defined")
        
        if not vcon.dialog:
            print("  Issue: No dialog entries")
        
        for i, dialog in enumerate(vcon.dialog):
            if "parties" in dialog:
                max_party_idx = max(dialog["parties"]) if dialog["parties"] else -1
                if max_party_idx >= len(vcon.parties):
                    print(f"  Issue: Dialog {i} references invalid party index {max_party_idx}")
```

#### 2. Memory Issues with Large Conversations

**Problem**: Large conversations cause memory issues

**Solutions**:
```python
class StreamingVconWriter:
    """Write vCons in streaming fashion to handle large conversations."""
    
    def __init__(self, output_file: str):
        self.output_file = output_file
        self.base_vcon = None
    
    def initialize_vcon(self, metadata: Dict[str, Any]):
        """Initialize base vCon structure."""
        self.base_vcon = Vcon.build_new()
        # Add metadata, parties, etc.
    
    def add_dialog_batch(self, dialogs: List[Dialog]):
        """Add dialogs in batches to manage memory."""
        for dialog in dialogs:
            self.base_vcon.add_dialog(dialog)
        
        # Periodically flush to disk if needed
        if len(self.base_vcon.dialog) > 1000:
            self.flush_to_disk()
    
    def flush_to_disk(self):
        """Flush current vCon to disk."""
        self.base_vcon.save_to_file(self.output_file)
```

#### 3. Character Encoding Issues

**Problem**: Non-UTF-8 characters in source data

**Solutions**:
```python
def safe_decode_text(raw_text: bytes, fallback_encoding: str = "latin-1") -> str:
    """Safely decode text with fallback encoding."""
    try:
        return raw_text.decode("utf-8")
    except UnicodeDecodeError:
        try:
            return raw_text.decode(fallback_encoding)
        except UnicodeDecodeError:
            # Last resort: replace invalid characters
            return raw_text.decode("utf-8", errors="replace")

def sanitize_content(content: str) -> str:
    """Sanitize content for vCon compatibility."""
    # Remove null bytes and other problematic characters
    content = content.replace("\x00", "")
    
    # Normalize unicode
    import unicodedata
    content = unicodedata.normalize("NFKC", content)
    
    return content
```

### Testing and Validation Tools

```python
class AdapterTestSuite:
    """Comprehensive test suite for vCon adapters."""
    
    def __init__(self, adapter: BaseVconAdapter):
        self.adapter = adapter
    
    def run_full_test_suite(self, test_data: List[Any]) -> Dict[str, Any]:
        """Run complete test suite on adapter."""
        results = {
            "total_tests": len(test_data),
            "successful": 0,
            "failed": 0,
            "errors": []
        }
        
        for i, data in enumerate(test_data):
            try:
                vcon = self.adapter.process(data)
                
                # Validate vCon
                is_valid, errors = vcon.is_valid()
                if is_valid:
                    results["successful"] += 1
                else:
                    results["failed"] += 1
                    results["errors"].append(f"Test {i}: {errors}")
                    
            except Exception as e:
                results["failed"] += 1
                results["errors"].append(f"Test {i}: Exception {e}")
        
        return results
    
    def benchmark_adapter(self, test_data: List[Any]) -> Dict[str, float]:
        """Benchmark adapter performance."""
        import time
        
        start_time = time.time()
        
        for data in test_data:
            self.adapter.process(data)
        
        end_time = time.time()
        
        total_time = end_time - start_time
        avg_time = total_time / len(test_data)
        
        return {
            "total_time": total_time,
            "average_time_per_item": avg_time,
            "items_per_second": len(test_data) / total_time
        }
```

---

This guide provides a comprehensive foundation for building robust vCon adapters. The patterns and examples can be adapted for specific use cases and source systems while maintaining compliance with the vCon specification.