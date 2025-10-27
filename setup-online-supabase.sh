#!/bin/bash

echo "🚀 Setting up Online Supabase Configuration"
echo "==========================================="
echo ""

# Check if .env already exists
if [ -f ".env" ]; then
    echo "⚠️  .env file already exists. Backing up to .env.backup"
    cp .env .env.backup
fi

echo "📋 Please provide your Supabase credentials:"
echo ""

# Get Supabase URL
read -p "Enter your Supabase URL (e.g., https://your-project-id.supabase.co): " SUPABASE_URL

# Get Supabase Anon Key
read -p "Enter your Supabase Anon Key (starts with eyJ...): " SUPABASE_ANON_KEY

# Validate inputs
if [[ -z "$SUPABASE_URL" || -z "$SUPABASE_ANON_KEY" ]]; then
    echo "❌ Error: Both URL and Anon Key are required"
    exit 1
fi

# Create .env file
cat > .env << EOF
# Supabase Configuration for Online Instance
SUPABASE_URL=$SUPABASE_URL
SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY

# Optional: Redis Cache (for production performance)
# REDIS_URL=redis://localhost:6379

# Optional: Plugin Configuration
# VCON_PLUGINS_PATH=./examples/logging-plugin.js
# VCON_LICENSE_KEY=your-license-key
# VCON_OFFLINE_MODE=false
EOF

echo ""
echo "✅ .env file created successfully!"
echo ""

# Test the connection
echo "🧪 Testing connection to online Supabase..."
echo ""

# Run a simple test
npx tsx -e "
import { getSupabaseClient } from './src/db/client.js';
import dotenv from 'dotenv';

dotenv.config();

async function testConnection() {
    try {
        const supabase = getSupabaseClient();
        const { data, error } = await supabase.from('vcons').select('count').limit(1);
        
        if (error) {
            console.log('❌ Connection failed:', error.message);
            return false;
        }
        
        console.log('✅ Successfully connected to online Supabase!');
        console.log('📊 Database is accessible and ready for performance testing');
        return true;
    } catch (err) {
        console.log('❌ Connection failed:', err.message);
        return false;
    }
}

testConnection().then(success => {
    if (success) {
        console.log('');
        console.log('🎯 Ready for performance testing!');
        console.log('Run: npx tsx scripts/load-legacy-vcons.ts /path/to/vcons --batch-size=100 --concurrency=1');
    } else {
        console.log('');
        console.log('🔧 Please check your credentials and try again');
    }
});
"

echo ""
echo "🎯 Next Steps:"
echo "1. If connection test passed, you're ready for performance testing!"
echo "2. Run: npx tsx scripts/load-legacy-vcons.ts /Volumes/OffStorage/strolid_vcons/03/15 --batch-size=100 --concurrency=1"
echo "3. Compare performance with local Supabase results"
echo "4. Test higher concurrency and batch sizes"
echo ""
echo "Expected improvements:"
echo "• 3-5x faster processing speed"
echo "• Support for higher concurrency (3-10 threads)"
echo "• Support for larger batch sizes (500-1000 files)"
echo "• Better reliability under load"
