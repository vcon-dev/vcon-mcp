-- Add missing foreign key constraints for vcon relationships

-- Add parties foreign key if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'parties_vcon_id_fkey' 
        AND table_name = 'parties'
    ) THEN
        ALTER TABLE parties 
        ADD CONSTRAINT parties_vcon_id_fkey 
        FOREIGN KEY (vcon_id) REFERENCES vcons(id) ON DELETE CASCADE;
    END IF;
END $$;

-- Add analysis foreign key if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'analysis_vcon_id_fkey' 
        AND table_name = 'analysis'
    ) THEN
        ALTER TABLE analysis 
        ADD CONSTRAINT analysis_vcon_id_fkey 
        FOREIGN KEY (vcon_id) REFERENCES vcons(id) ON DELETE CASCADE;
    END IF;
END $$;

-- Add attachments foreign key if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'attachments_vcon_id_fkey' 
        AND table_name = 'attachments'
    ) THEN
        ALTER TABLE attachments 
        ADD CONSTRAINT attachments_vcon_id_fkey 
        FOREIGN KEY (vcon_id) REFERENCES vcons(id) ON DELETE CASCADE;
    END IF;
END $$;