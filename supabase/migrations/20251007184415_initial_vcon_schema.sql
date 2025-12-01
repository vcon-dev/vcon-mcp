-- Supabase Schema for IETF vCon - CORRECTED VERSION
-- This schema is fully compliant with draft-ietf-vcon-vcon-core-00
-- Changes from original marked with -- CORRECTED comments

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA extensions;

-- Main vCons table
CREATE TABLE vcons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    uuid UUID UNIQUE NOT NULL, -- The vCon UUID from the original document
    vcon_version VARCHAR(10) NOT NULL DEFAULT '0.3.0',  -- CORRECTED: Updated to latest spec version
    subject TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Original metadata fields
    basename TEXT,
    filename TEXT,
    done BOOLEAN DEFAULT false,
    corrupt BOOLEAN DEFAULT false,
    processed_by TEXT,
    
    -- Privacy tracking fields (EXTENSION - not in core spec)
    privacy_processed JSONB DEFAULT '{}',
    redaction_rules JSONB DEFAULT '{}',
    
    -- JSON fields for complex nested data
    redacted JSONB DEFAULT '{}',
    appended JSONB DEFAULT '{}',  -- CORRECTED: Added appended support per spec
    group_data JSONB DEFAULT '[]',
    extensions TEXT[],  -- CORRECTED: Added extensions array per spec Section 4.1.3
    must_support TEXT[],  -- CORRECTED: Added must_support array per spec Section 4.1.4
    
    CONSTRAINT valid_uuid CHECK (uuid IS NOT NULL)
);

-- Parties table (normalized for efficient searching)
CREATE TABLE parties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vcon_id UUID NOT NULL REFERENCES vcons(id) ON DELETE CASCADE,
    party_index INTEGER NOT NULL, -- Index in the original parties array
    
    -- Core vCon Party Object fields (Section 4.2)
    tel TEXT,
    sip TEXT,
    stir TEXT,
    mailto TEXT,
    name TEXT,
    did TEXT,  -- CORRECTED: Added DID support per spec Section 4.2.6
    validation TEXT,
    jcard JSONB,
    gmlpos TEXT,
    civicaddress JSONB,
    timezone TEXT,
    uuid UUID,  -- CORRECTED: Added uuid per spec Section 4.2.12
    
    -- EXTENSION FIELDS (not in core spec) - for privacy compliance
    data_subject_id TEXT, -- Consistent identifier across vCons for privacy
    
    -- Additional party metadata as JSON
    metadata JSONB DEFAULT '{}',
    
    UNIQUE(vcon_id, party_index)
);

-- Dialog table for conversations/recordings
CREATE TABLE dialog (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vcon_id UUID NOT NULL REFERENCES vcons(id) ON DELETE CASCADE,
    dialog_index INTEGER NOT NULL, -- Index in the original dialog array
    
    -- Core Dialog Object fields (Section 4.3)
    type TEXT NOT NULL CHECK (type IN ('recording', 'text', 'transfer', 'incomplete')), -- CORRECTED: Added constraint per spec Section 4.3.1
    start_time TIMESTAMPTZ,
    duration_seconds REAL,
    parties INTEGER[], -- Array of party indexes
    originator INTEGER,
    mediatype TEXT,
    filename TEXT,
    
    -- Content fields
    body TEXT, -- For text dialogs or transcripts
    encoding TEXT CHECK (encoding IS NULL OR encoding IN ('base64url', 'json', 'none')), -- CORRECTED: Removed default, added constraint
    url TEXT,
    content_hash TEXT,
    
    -- Additional fields per spec
    disposition TEXT CHECK (disposition IS NULL OR disposition IN ('no-answer', 'congestion', 'failed', 'busy', 'hung-up', 'voicemail-no-message')),
    session_id TEXT,  -- CORRECTED: Added session_id per spec Section 4.3.10
    application TEXT,  -- CORRECTED: Added application per spec Section 4.3.13
    message_id TEXT,  -- CORRECTED: Added message_id per spec Section 4.3.14
    
    size_bytes BIGINT,
    
    -- Additional dialog metadata as JSON
    metadata JSONB DEFAULT '{}',
    
    UNIQUE(vcon_id, dialog_index)
);

-- Party history table (Section 4.3.11)
CREATE TABLE party_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dialog_id UUID NOT NULL REFERENCES dialog(id) ON DELETE CASCADE,
    party_index INTEGER NOT NULL,
    time TIMESTAMPTZ NOT NULL,
    event TEXT NOT NULL CHECK (event IN ('join', 'drop', 'hold', 'unhold', 'mute', 'unmute'))
);

-- Attachments table (normalized for efficient searching)
CREATE TABLE attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vcon_id UUID NOT NULL REFERENCES vcons(id) ON DELETE CASCADE,
    attachment_index INTEGER NOT NULL, -- Index in the original attachments array
    
    -- Core Attachment Object fields (Section 4.4)
    type TEXT,
    start_time TIMESTAMPTZ,
    party INTEGER,  -- CORRECTED: Singular party index per spec Section 4.4.3
    dialog INTEGER,  -- CORRECTED: Added dialog reference per spec Section 4.4.4
    
    -- Content fields
    mimetype TEXT,
    filename TEXT,
    body TEXT,
    encoding TEXT CHECK (encoding IS NULL OR encoding IN ('base64url', 'json', 'none')), -- CORRECTED: Removed default, added constraint
    url TEXT,
    content_hash TEXT,
    
    size_bytes BIGINT,
    
    -- Additional attachment metadata as JSON
    metadata JSONB DEFAULT '{}',
    
    UNIQUE(vcon_id, attachment_index)
);

-- Analysis table (normalized for efficient searching by analysis type)
CREATE TABLE analysis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vcon_id UUID NOT NULL REFERENCES vcons(id) ON DELETE CASCADE,
    analysis_index INTEGER NOT NULL, -- Index in the original analysis array
    
    -- Core Analysis Object fields (Section 4.5)
    type TEXT NOT NULL, -- e.g., 'summary', 'transcript', 'translation', 'sentiment', 'tts'
    dialog_indices INTEGER[],  -- CORRECTED: Added array reference per spec Section 4.5.2
    mediatype TEXT,
    filename TEXT,
    vendor TEXT NOT NULL, -- CORRECTED: Made required per spec Section 4.5.5
    product TEXT,
    schema TEXT,  -- CORRECTED: Changed from schema_version to schema per spec Section 4.5.7
    
    -- Content fields
    body TEXT,  -- CORRECTED: Changed from JSONB to TEXT to support non-JSON analysis per spec Section 4.5.8
    encoding TEXT CHECK (encoding IS NULL OR encoding IN ('base64url', 'json', 'none')), -- CORRECTED: Removed default, added constraint
    url TEXT,
    content_hash TEXT,
    
    -- Additional analysis metadata
    created_at TIMESTAMPTZ,
    confidence REAL,
    metadata JSONB DEFAULT '{}',
    
    UNIQUE(vcon_id, analysis_index)
);

-- Group table for aggregated vCons (Section 4.6)
CREATE TABLE groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vcon_id UUID NOT NULL REFERENCES vcons(id) ON DELETE CASCADE,
    group_index INTEGER NOT NULL,
    
    -- Core Group Object fields
    uuid UUID,  -- UUID of referenced vCon
    body TEXT,  -- Inline vCon content
    encoding TEXT CHECK (encoding = 'json'),  -- Must be 'json' per spec
    url TEXT,
    content_hash TEXT,
    
    UNIQUE(vcon_id, group_index)
);

-- EXTENSION TABLES (not in core spec) - for privacy compliance

-- Privacy requests tracking table
CREATE TABLE privacy_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id TEXT UNIQUE NOT NULL,
    party_identifier TEXT NOT NULL,
    party_name TEXT,
    request_type TEXT NOT NULL CHECK (request_type IN (
        'access', 'rectification', 'erasure', 'portability', 'restriction', 'objection'
    )),
    request_status TEXT NOT NULL DEFAULT 'pending' CHECK (request_status IN (
        'pending', 'in_progress', 'completed', 'rejected', 'partially_completed'
    )),
    request_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completion_date TIMESTAMPTZ,
    verification_method TEXT,
    verification_date TIMESTAMPTZ,
    request_details JSONB DEFAULT '{}',
    processing_notes TEXT,
    rejection_reason TEXT,
    acknowledgment_sent_date TIMESTAMPTZ,
    response_sent_date TIMESTAMPTZ,
    response_method TEXT,
    processed_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'
);

-- Create indexes for common queries
CREATE INDEX idx_vcons_uuid ON vcons(uuid);
CREATE INDEX idx_vcons_created_at ON vcons(created_at);
CREATE INDEX idx_vcons_updated_at ON vcons(updated_at);

-- Party indexes
CREATE INDEX idx_parties_vcon ON parties(vcon_id);
CREATE INDEX idx_parties_tel ON parties(tel) WHERE tel IS NOT NULL;
CREATE INDEX idx_parties_email ON parties(mailto) WHERE mailto IS NOT NULL;
CREATE INDEX idx_parties_name ON parties(name) WHERE name IS NOT NULL;
CREATE INDEX idx_parties_uuid ON parties(uuid) WHERE uuid IS NOT NULL;  -- CORRECTED: Added
CREATE INDEX idx_parties_data_subject ON parties(data_subject_id) WHERE data_subject_id IS NOT NULL;

-- Dialog indexes
CREATE INDEX idx_dialog_vcon ON dialog(vcon_id);
CREATE INDEX idx_dialog_type ON dialog(type);
CREATE INDEX idx_dialog_start ON dialog(start_time);
CREATE INDEX idx_dialog_session ON dialog(session_id) WHERE session_id IS NOT NULL;  -- CORRECTED: Added

-- Attachment indexes
CREATE INDEX idx_attachments_vcon ON attachments(vcon_id);
CREATE INDEX idx_attachments_type ON attachments(type);
CREATE INDEX idx_attachments_party ON attachments(party);
CREATE INDEX idx_attachments_dialog ON attachments(dialog);  -- CORRECTED: Added

-- Analysis indexes
CREATE INDEX idx_analysis_vcon ON analysis(vcon_id);
CREATE INDEX idx_analysis_type ON analysis(type);
CREATE INDEX idx_analysis_vendor ON analysis(vendor);
CREATE INDEX idx_analysis_product ON analysis(product) WHERE product IS NOT NULL;
CREATE INDEX idx_analysis_schema ON analysis(schema) WHERE schema IS NOT NULL;  -- CORRECTED: Renamed from schema_version
CREATE INDEX idx_analysis_dialog ON analysis USING GIN (dialog_indices);  -- CORRECTED: Added for dialog array

-- Group indexes
CREATE INDEX idx_groups_vcon ON groups(vcon_id);
CREATE INDEX idx_groups_uuid ON groups(uuid) WHERE uuid IS NOT NULL;
