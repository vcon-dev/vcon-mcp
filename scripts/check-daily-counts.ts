/**
 * Check Daily vCon Counts
 * 
 * Analyzes vCon counts per day to identify gaps or anomalies in data collection
 */

import 'dotenv/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  blue: '\x1b[34m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

interface DailyCount {
  date: string;
  count: number;
}

function printHeader(title: string) {
  console.log(`\n${colors.blue}${'='.repeat(80)}${colors.reset}`);
  console.log(`${colors.blue}${title}${colors.reset}`);
  console.log(`${colors.blue}${'='.repeat(80)}${colors.reset}`);
}

function formatDate(dateString: string): string {
  return dateString.split('T')[0];
}

async function checkDailyCounts() {
  // Get credentials from environment
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error(`${colors.red}ERROR: Missing database credentials${colors.reset}`);
    console.error('Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables');
    process.exit(1);
  }

  printHeader('Daily vCon Count Analysis');
  console.log(`Connecting to: ${supabaseUrl}\n`);

  // Create Supabase client
  const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  try {
    // Test connection
    const { error: testError } = await supabase.from('vcons').select('id').limit(1);
    if (testError) {
      console.error(`${colors.red}ERROR: Failed to connect to database${colors.reset}`);
      console.error(testError.message);
      process.exit(1);
    }
    console.log(`${colors.green}✓ Connected successfully${colors.reset}\n`);
  } catch (error) {
    console.error(`${colors.red}ERROR: Connection failed${colors.reset}`);
    console.error(error);
    process.exit(1);
  }

  console.log('Fetching date range and daily counts...\n');
  
  // Get min and max dates
  const { data: minData } = await supabase
    .from('vcons')
    .select('created_at')
    .order('created_at', { ascending: true })
    .limit(1);
    
  const { data: maxData } = await supabase
    .from('vcons')
    .select('created_at')
    .order('created_at', { ascending: false })
    .limit(1);
  
  if (!minData || !maxData || minData.length === 0 || maxData.length === 0) {
    console.error(`${colors.red}ERROR: Could not fetch date range${colors.reset}`);
    process.exit(1);
  }
  
  const minDate = new Date(minData[0].created_at);
  const maxDate = new Date(maxData[0].created_at);
  
  console.log(`Date Range: ${formatDate(minDate.toISOString())} to ${formatDate(maxDate.toISOString())}`);
  
  // Query counts day by day
  const counts: DailyCount[] = [];
  const currentDate = new Date(minDate);
  const endDate = new Date(maxDate);
  
  let processedDays = 0;
  
  while (currentDate <= endDate) {
    const dateStr = formatDate(currentDate.toISOString());
    const nextDate = new Date(currentDate);
    nextDate.setDate(nextDate.getDate() + 1);
    const nextDateStr = formatDate(nextDate.toISOString());
    
    const { count, error } = await supabase
      .from('vcons')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', dateStr)
      .lt('created_at', nextDateStr);
    
    if (!error && count !== null) {
      counts.push({ date: dateStr, count });
    }
    
    processedDays++;
    if (processedDays % 10 === 0) {
      process.stdout.write(`\rProcessed ${processedDays} days...`);
    }
    
    currentDate.setDate(currentDate.getDate() + 1);
  }
  console.log(`\n\n${colors.green}✓ Completed fetching daily counts${colors.reset}`);

  if (counts.length === 0) {
    console.error(`${colors.red}ERROR: No data retrieved${colors.reset}`);
    process.exit(1);
  }

  // Get full date range including gaps
  const startDate = new Date(counts[0].date);
  endDate.setTime(new Date(counts[counts.length - 1].date).getTime());
  
  // Create complete date range
  const allDates = new Map<string, number>();
  const current = new Date(startDate);
  while (current <= endDate) {
    allDates.set(formatDate(current.toISOString()), 0);
    current.setDate(current.getDate() + 1);
  }

  // Fill in actual counts
  counts.forEach(({ date, count }) => {
    allDates.set(date, count);
  });

  // Convert back to sorted array
  const completeCounts = Array.from(allDates.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Calculate statistics
  const totalDays = completeCounts.length;
  const daysWithData = completeCounts.filter(d => d.count > 0).length;
  const daysWithoutData = totalDays - daysWithData;
  const totalVcons = completeCounts.reduce((sum, d) => sum + d.count, 0);
  const avgPerDay = daysWithData > 0 ? totalVcons / daysWithData : 0;
  const maxCount = Math.max(...completeCounts.map(d => d.count));
  const minCountWithData = Math.min(...completeCounts.filter(d => d.count > 0).map(d => d.count));

  // Find gaps (consecutive days with zero counts)
  const gaps: { start: string; end: string; days: number }[] = [];
  let gapStart: string | null = null;
  let gapDays = 0;

  completeCounts.forEach(({ date, count }) => {
    if (count === 0) {
      if (gapStart === null) {
        gapStart = date;
        gapDays = 1;
      } else {
        gapDays++;
      }
    } else {
      if (gapStart !== null && gapDays > 0) {
        const prevDate = new Date(date);
        prevDate.setDate(prevDate.getDate() - 1);
        gaps.push({
          start: gapStart,
          end: formatDate(prevDate.toISOString()),
          days: gapDays,
        });
        gapStart = null;
        gapDays = 0;
      }
    }
  });

  // If we ended in a gap, add it
  if (gapStart !== null && gapDays > 0) {
    gaps.push({
      start: gapStart,
      end: completeCounts[completeCounts.length - 1].date,
      days: gapDays,
    });
  }

  // Display statistics
  printHeader('STATISTICS');
  console.log(`Total Days Analyzed:     ${totalDays}`);
  console.log(`Days with Data:          ${daysWithData} (${((daysWithData / totalDays) * 100).toFixed(1)}%)`);
  console.log(`Days without Data:       ${daysWithoutData} (${((daysWithoutData / totalDays) * 100).toFixed(1)}%)`);
  console.log(`Total vCons:             ${totalVcons.toLocaleString()}`);
  console.log(`Average per Day:         ${avgPerDay.toFixed(0)}`);
  console.log(`Maximum in One Day:      ${maxCount.toLocaleString()}`);
  console.log(`Minimum in One Day:      ${minCountWithData > 0 && minCountWithData !== Infinity ? minCountWithData.toLocaleString() : 'N/A'}`);

  // Display gaps
  if (gaps.length > 0) {
    printHeader('DATA GAPS IDENTIFIED');
    console.log(`Found ${gaps.length} gap(s) in the data:\n`);
    
    const largeGaps = gaps.filter(g => g.days >= 2);
    const displayGaps = largeGaps.length > 0 ? largeGaps : gaps;
    
    displayGaps.slice(0, 20).forEach((gap, index) => {
      const color = gap.days > 7 ? colors.red : gap.days > 3 ? colors.yellow : colors.cyan;
      console.log(`${color}Gap #${index + 1}:${colors.reset}`);
      console.log(`  Start: ${gap.start}`);
      console.log(`  End:   ${gap.end}`);
      console.log(`  Duration: ${gap.days} day(s)`);
      console.log('');
    });
    
    if (displayGaps.length > 20) {
      console.log(`... and ${displayGaps.length - 20} more gaps\n`);
    }
    
    if (largeGaps.length < gaps.length) {
      console.log(`${colors.cyan}Note: Showing only gaps of 2+ days. Total single-day gaps: ${gaps.length - largeGaps.length}${colors.reset}\n`);
    }
  } else {
    console.log(`\n${colors.green}✓ No gaps found - data collected every day!${colors.reset}\n`);
  }

  // Find anomalies (days with unusually low counts)
  if (avgPerDay > 0) {
    const threshold = avgPerDay * 0.1; // Less than 10% of average
    const anomalies = completeCounts.filter(d => d.count > 0 && d.count < threshold);

    if (anomalies.length > 0) {
      printHeader('LOW COUNT ANOMALIES');
      console.log(`Days with unusually low counts (< ${threshold.toFixed(0)}, which is 10% of average):\n`);
      
      anomalies.slice(0, 20).forEach(({ date, count }) => {
        const percentOfAvg = (count / avgPerDay) * 100;
        console.log(`${colors.yellow}${date}${colors.reset}: ${count.toLocaleString()} vCons (${percentOfAvg.toFixed(1)}% of average)`);
      });
      
      if (anomalies.length > 20) {
        console.log(`\n... and ${anomalies.length - 20} more anomalies`);
      }
      console.log('');
    }
  }

  // Display recent 30 days
  printHeader('RECENT 30 DAYS');
  const recent30 = completeCounts.slice(-30);
  
  console.log('\nDate       | Count     | Graph');
  console.log('-----------+-----------+' + '-'.repeat(50));
  
  const maxRecent = Math.max(...recent30.map(d => d.count));
  const threshold = avgPerDay * 0.1;
  
  recent30.forEach(({ date, count }) => {
    const barWidth = maxRecent > 0 ? Math.floor((count / maxRecent) * 40) : 0;
    const bar = '█'.repeat(barWidth);
    const color = count === 0 ? colors.red : count < threshold ? colors.yellow : colors.green;
    console.log(`${date} | ${String(count).padStart(9)} | ${color}${bar}${colors.reset}`);
  });

  // Monthly summary
  printHeader('MONTHLY SUMMARY');
  
  const monthlyMap = new Map<string, { count: number; days: number }>();
  completeCounts.forEach(({ date, count }) => {
    const month = date.substring(0, 7); // YYYY-MM
    const existing = monthlyMap.get(month) || { count: 0, days: 0 };
    monthlyMap.set(month, {
      count: existing.count + count,
      days: existing.days + (count > 0 ? 1 : 0),
    });
  });

  console.log('\nMonth    | Total vCons | Days with Data | Avg/Day');
  console.log('---------+-------------+----------------+---------');
  
  Array.from(monthlyMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([month, { count, days }]) => {
      const avg = days > 0 ? count / days : 0;
      const totalDaysInMonth = completeCounts.filter(d => d.date.startsWith(month)).length;
      const coverage = totalDaysInMonth > 0 ? (days / totalDaysInMonth * 100).toFixed(0) : '0';
      console.log(`${month}  | ${String(count).padStart(11)} | ${String(days).padStart(14)} | ${avg.toFixed(0).padStart(7)} (${coverage}%)`);
    });

  console.log(`\n${colors.blue}${'='.repeat(80)}${colors.reset}\n`);
}

checkDailyCounts().catch((error) => {
  console.error(`${colors.red}Fatal error:${colors.reset}`, error);
  process.exit(1);
});

