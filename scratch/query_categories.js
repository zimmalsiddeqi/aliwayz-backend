const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
  const { data: categories, error } = await supabase
    .from('categories')
    .select('id, name, slug, parent_id');

  if (error) {
    console.error('Error fetching categories:', error);
    return;
  }

  console.log('Categories count:', categories.length);
  console.log('Categories:', categories);
}

run().catch(console.error);
