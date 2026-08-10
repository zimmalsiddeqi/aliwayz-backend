'use strict';

require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const slugify = require('slugify');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ─────────────────────────────────────────
// All categories from PRD (exact match)
// ─────────────────────────────────────────
const categories = [
  { name: 'Electronics',      order: 1,  children: ['Phones', 'Laptops', 'Gaming'] },
  { name: 'Fashion',          order: 2,  children: ['Shoes', 'Bags', 'Jewelry', 'Beauty'] },
  { name: 'Home',             order: 3,  children: ['Kitchen', 'Furniture', 'Appliances'] },
  { name: 'Sports',           order: 4,  children: ['Fitness'] },
  { name: 'Books',            order: 5,  children: [] },
  { name: 'Toys',             order: 6,  children: [] },
  { name: 'Baby',             order: 7,  children: [] },
  { name: 'Pets',             order: 8,  children: [] },
  { name: 'Automotive',       order: 9,  children: ['Automotive Parts', 'Motorcycle Parts'] },
  { name: 'Garden',           order: 10, children: [] },
  { name: 'Tools',            order: 11, children: [] },
  { name: 'Office',           order: 12, children: [] },
  { name: 'Music',            order: 13, children: [] },
  { name: 'Collectibles',     order: 14, children: [] },
  { name: 'Photography',      order: 15, children: [] },
  { name: 'Drones',           order: 16, children: [] },
  { name: 'Art',              order: 17, children: [] },
  { name: 'Handmade',         order: 18, children: [] },
  { name: 'Digital Products', order: 19, children: [] },
  { name: 'Other',            order: 20, children: [] },
];

// ✅ Stable slug — no random suffix for categories
const createSlugFromName = (name) =>
  slugify(name, { lower: true, strict: true });

async function seedCategories() {
  console.log('🌱 Seeding categories...');

  for (const cat of categories) {
    const { data: parent, error: parentError } = await supabase
      .from('categories')
      .upsert(
        {
          name: cat.name,
          slug: createSlugFromName(cat.name),
          display_order: cat.order,
          is_active: true,
          parent_id: null,
        },
        { onConflict: 'slug' }
      )
      .select('id')
      .single();

    if (parentError) {
      console.error(`Failed to insert category: ${cat.name}`, parentError);
      continue;
    }

    console.log(`✅ Category: ${cat.name} (id: ${parent.id})`);

    for (let i = 0; i < cat.children.length; i++) {
      const childName = cat.children[i];
      const { error: childError } = await supabase
        .from('categories')
        .upsert(
          {
            name: childName,
            slug: createSlugFromName(childName),
            parent_id: parent.id,
            display_order: i + 1,
            is_active: true,
          },
          { onConflict: 'slug' }
        );

      if (childError) {
        console.error(`  Failed to insert subcategory: ${childName}`, childError);
      } else {
        console.log(`   └── ${childName}`);
      }
    }
  }

  console.log('\n✅ Category seeding complete!');
  process.exit(0);
}

seedCategories().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});