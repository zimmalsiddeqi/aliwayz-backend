'use strict';

require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const slugify = require('slugify');
const { v5: uuidv5 } = require('uuid');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Standard DNS namespace for UUIDv5
const NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

const categoryTree = [
  {
    name: 'Electronics',
    children: [
      {
        name: 'Phones & Tablets',
        children: ['iPhone', 'Samsung Galaxy', 'Google Pixel', 'Other Smartphones', 'Tablets', 'iPads', 'Smartwatches', 'Phone Accessories', 'Phone Cases', 'Chargers & Cables']
      },
      {
        name: 'Computers',
        children: ['Laptops', 'MacBooks', 'Desktop Computers', 'Gaming PCs', 'Chromebooks', 'Computer Monitors', 'Keyboards', 'Mice', 'Computer Accessories']
      },
      {
        name: 'TVs & Home Theater',
        children: ['TVs', 'Smart TVs', 'Projectors', 'Soundbars', 'Speakers', 'Home Theater Systems', 'Streaming Devices', 'TV Accessories']
      },
      {
        name: 'Gaming',
        children: ['PlayStation', 'Xbox', 'Nintendo', 'Gaming Consoles', 'Video Games', 'Controllers', 'Gaming Accessories', 'VR Headsets']
      },
      {
        name: 'Cameras',
        children: ['Digital Cameras', 'DSLR', 'Mirrorless', 'Lenses', 'Camera Accessories', 'Drones', 'Action Cameras']
      },
      {
        name: 'Audio',
        children: ['Headphones', 'Earbuds', 'Bluetooth Speakers', 'Microphones', 'Amplifiers', 'Audio Equipment']
      },
      {
        name: 'Smart Home',
        children: ['Smart Lights', 'Smart Speakers', 'Smart Cameras', 'Smart Doorbells', 'Smart Locks', 'Other Smart Home']
      }
    ]
  },
  {
    name: 'Vehicles',
    children: [
      {
        name: 'Cars & Trucks',
        children: ['Cars', 'SUVs', 'Trucks', 'Vans', 'Electric Vehicles', 'Hybrid Vehicles', 'Classic Cars', 'Luxury Cars']
      },
      {
        name: 'Motorcycles',
        children: ['Motorcycles', 'Scooters', 'Dirt Bikes', 'ATVs', 'UTVs']
      },
      {
        name: 'RVs & Campers',
        children: ['RVs', 'Motorhomes', 'Travel Trailers', 'Fifth Wheels', 'Campers']
      },
      {
        name: 'Boats',
        children: ['Boats', 'Jet Skis', 'Kayaks', 'Canoes', 'Other Watercraft']
      },
      {
        name: 'Vehicle Accessories',
        children: ['Wheels', 'Tires', 'Roof Racks', 'Towing Equipment', 'Car Accessories', 'Interior Accessories']
      }
    ]
  },
  {
    name: 'Auto Parts & Accessories',
    children: [
      {
        name: 'Exterior Parts',
        children: ['Bumpers', 'Grilles', 'Fenders', 'Hoods', 'Doors', 'Mirrors', 'Spoilers', 'Body Panels']
      },
      {
        name: 'Interior Parts',
        children: ['Seats', 'Dashboards', 'Floor Mats', 'Steering Wheels', 'Interior Trim']
      },
      {
        name: 'Performance',
        children: ['Exhaust', 'Air Intake', 'Turbo Parts', 'Performance Parts']
      },
      {
        name: 'Mechanical',
        children: ['Engines', 'Transmissions', 'Brakes', 'Suspension', 'Steering', 'Cooling', 'Fuel System']
      },
      {
        name: 'Electrical',
        children: ['Batteries', 'Alternators', 'Starters', 'Sensors', 'Lights', 'Electrical Components']
      },
      {
        name: 'Wheels & Tires',
        children: ['Wheels', 'Rims', 'Tires', 'Wheel Accessories']
      }
    ]
  },
  {
    name: 'Home & Furniture',
    children: [
      {
        name: 'Furniture',
        children: ['Sofas & Couches', 'Chairs', 'Tables', 'Dining Sets', 'Beds', 'Mattresses', 'Dressers', 'Nightstands', 'Desks', 'Bookshelves', 'Cabinets', 'Office Furniture']
      },
      {
        name: 'Home Decor',
        children: ['Wall Art', 'Mirrors', 'Rugs', 'Curtains', 'Lamps', 'Lighting', 'Pillows', 'Blankets', 'Decorative Items']
      },
      {
        name: 'Kitchen',
        children: ['Cookware', 'Dinnerware', 'Glassware', 'Kitchen Tools', 'Utensils', 'Storage', 'Coffee & Tea Items']
      },
      {
        name: 'Home Improvement',
        children: ['Building Materials', 'Doors', 'Windows', 'Flooring', 'Lighting', 'Hardware', 'Plumbing Items', 'Electrical Items']
      }
    ]
  },
  {
    name: 'Fashion',
    children: [
      {
        name: 'Women’s Clothing',
        children: ['Dresses', 'Tops', 'Shirts', 'Jeans', 'Pants', 'Skirts', 'Shorts', 'Jackets', 'Coats', 'Activewear', 'Swimwear', 'Maternity Clothing']
      },
      {
        name: 'Men’s Clothing',
        children: ['T-Shirts', 'Shirts', 'Jeans', 'Pants', 'Shorts', 'Suits', 'Jackets', 'Coats', 'Activewear', 'Swimwear']
      },
      {
        name: 'Kids Clothing',
        children: ['Boys', 'Girls', 'Baby Clothing', 'Kids Accessories']
      },
      {
        name: 'Bags',
        children: ['Handbags', 'Backpacks', 'Wallets', 'Luggage', 'Travel Bags', 'Briefcases']
      },
      {
        name: 'Accessories',
        children: ['Hats', 'Belts', 'Sunglasses', 'Scarves', 'Gloves', 'Ties', 'Fashion Accessories']
      }
    ]
  },
  {
    name: 'Shoes',
    children: [
      { name: 'Men’s Shoes' },
      { name: 'Women’s Shoes' },
      { name: 'Kids’ Shoes' },
      { name: 'Sneakers' },
      { name: 'Athletic Shoes' },
      { name: 'Boots' },
      { name: 'Dress Shoes' },
      { name: 'Sandals' },
      { name: 'Heels' },
      { name: 'Work Shoes' },
      { name: 'Vintage Shoes' },
      { name: 'Collectible Sneakers' }
    ]
  },
  {
    name: 'Jewelry & Watches',
    children: [
      {
        name: 'Jewelry',
        children: ['Rings', 'Necklaces', 'Earrings', 'Bracelets', 'Brooches', 'Gold Jewelry', 'Silver Jewelry', 'Costume Jewelry', 'Handmade Jewelry']
      },
      {
        name: 'Watches',
        children: ['Men’s Watches', 'Women’s Watches', 'Smartwatches', 'Luxury Watches', 'Vintage Watches', 'Watch Accessories']
      }
    ]
  },
  {
    name: 'Beauty & Personal Care',
    children: [
      {
        name: 'Beauty',
        children: ['Makeup', 'Makeup Accessories', 'Skincare', 'Hair Care', 'Hair Styling', 'Nail Care', 'Beauty Tools']
      },
      {
        name: 'Fragrance',
        children: ['Perfume', 'Cologne', 'Body Spray', 'Fragrance Sets']
      },
      {
        name: 'Personal Care',
        children: ['Bath & Body', 'Shaving', 'Grooming', 'Oral Care', 'Personal Care Accessories']
      }
    ]
  },
  {
    name: 'Baby & Kids',
    children: [
      {
        name: 'Baby Gear',
        children: ['Strollers', 'Car Seats', 'Cribs', 'High Chairs', 'Baby Carriers', 'Baby Monitors', 'Changing Tables']
      },
      {
        name: 'Baby Clothing',
        children: ['Baby Clothes', 'Shoes', 'Accessories']
      },
      {
        name: 'Nursery',
        children: ['Nursery Furniture', 'Bedding', 'Decor', 'Storage']
      },
      {
        name: 'Feeding',
        children: ['Bottles', 'Baby Feeding Accessories', 'High Chairs']
      }
    ]
  },
  {
    name: 'Toys & Games',
    children: [
      { name: 'Action Figures' },
      { name: 'Dolls' },
      { name: 'LEGO & Building Sets' },
      { name: 'Remote Control Toys' },
      { name: 'Educational Toys' },
      { name: 'Board Games' },
      { name: 'Card Games' },
      { name: 'Puzzles' },
      { name: 'Outdoor Toys' },
      { name: 'Collectible Toys' },
      { name: 'Video Games' },
      { name: 'Gaming Accessories' }
    ]
  },
  {
    name: 'Sports & Outdoors',
    children: [
      {
        name: 'Fitness',
        children: ['Weights', 'Dumbbells', 'Exercise Equipment', 'Treadmills', 'Exercise Bikes', 'Yoga', 'Resistance Bands']
      },
      {
        name: 'Team Sports',
        children: ['Basketball', 'Football', 'Soccer', 'Baseball', 'Hockey', 'Volleyball']
      },
      {
        name: 'Golf',
        children: ['Golf Clubs', 'Golf Bags', 'Golf Balls', 'Golf Accessories']
      },
      {
        name: 'Outdoor Recreation',
        children: ['Camping', 'Hiking', 'Fishing', 'Cycling', 'Kayaking', 'Hunting Gear', 'Outdoor Equipment']
      }
    ]
  },
  {
    name: 'Collectibles & Memorabilia',
    children: [
      {
        name: 'Trading Cards',
        children: ['Pokémon', 'Sports Cards', 'Magic: The Gathering', 'Yu-Gi-Oh!', 'Other Trading Cards']
      },
      {
        name: 'Sports Memorabilia',
        children: ['Football', 'Basketball', 'Baseball', 'Soccer', 'Hockey']
      },
      {
        name: 'Collectibles',
        children: ['Coins', 'Stamps', 'Figurines', 'Action Figures', 'Pins', 'Autographs', 'Posters', 'Memorabilia']
      },
      {
        name: 'Pop Culture',
        children: ['Movies', 'TV', 'Anime', 'Comics', 'Superheroes']
      }
    ]
  },
  {
    name: 'Books, Movies & Music',
    children: [
      {
        name: 'Books',
        children: ['Fiction', 'Nonfiction', 'Textbooks', 'Children’s Books', 'Comics', 'Manga', 'Collectible Books']
      },
      {
        name: 'Movies',
        children: ['DVDs', 'Blu-ray', 'Box Sets']
      },
      {
        name: 'Music',
        children: ['Vinyl Records', 'CDs', 'Cassettes', 'Music Collectibles']
      }
    ]
  },
  {
    name: 'Hobbies & Crafts',
    children: [
      {
        name: 'Crafts',
        children: ['Art Supplies', 'Drawing', 'Painting', 'Beads', 'Jewelry Making', 'Scrapbooking', 'Sewing']
      },
      {
        name: 'Models',
        children: ['Model Cars', 'Model Aircraft', 'Model Trains', 'Model Kits', 'Miniatures']
      },
      {
        name: 'Hobbies',
        children: ['LEGO', 'Puzzles', 'RC Vehicles', 'Drones', 'Collecting', 'DIY Projects']
      }
    ]
  },
  {
    name: 'Musical Instruments',
    children: [
      { name: 'Guitars' },
      { name: 'Basses' },
      { name: 'Pianos' },
      { name: 'Keyboards' },
      { name: 'Drums' },
      { name: 'Percussion' },
      { name: 'Violins' },
      { name: 'Brass Instruments' },
      { name: 'Woodwind Instruments' },
      { name: 'DJ Equipment' },
      { name: 'Microphones' },
      { name: 'Amplifiers' },
      { name: 'Speakers' },
      { name: 'Music Accessories' }
    ]
  },
  {
    name: 'Pet Supplies',
    children: [
      {
        name: 'Dogs',
        children: ['Beds', 'Toys', 'Collars & Leashes', 'Crates', 'Grooming', 'Food & Treats']
      },
      {
        name: 'Cats',
        children: ['Beds', 'Toys', 'Litter Boxes', 'Scratching Posts', 'Food & Treats']
      },
      {
        name: 'Birds',
        children: ['Cages', 'Toys', 'Accessories']
      },
      {
        name: 'Fish',
        children: ['Aquariums', 'Filters', 'Pumps', 'Decorations']
      },
      {
        name: 'Small Animals',
        children: ['Cages', 'Bedding', 'Toys', 'Accessories']
      }
    ]
  },
  {
    name: 'Tools & Equipment',
    children: [
      {
        name: 'Hand Tools',
        children: ['Wrenches', 'Screwdrivers', 'Pliers', 'Hammers', 'Saws']
      },
      {
        name: 'Power Tools',
        children: ['Drills', 'Impact Drivers', 'Saws', 'Grinders', 'Sanders']
      },
      {
        name: 'Tool Storage',
        children: ['Toolboxes', 'Tool Cabinets', 'Tool Bags']
      },
      {
        name: 'Equipment',
        children: ['Generators', 'Compressors', 'Welding Equipment', 'Ladders', 'Construction Equipment']
      }
    ]
  },
  {
    name: 'Appliances',
    children: [
      { name: 'Refrigerators' },
      { name: 'Freezers' },
      { name: 'Washers' },
      { name: 'Dryers' },
      { name: 'Ovens' },
      { name: 'Stoves' },
      { name: 'Microwaves' },
      { name: 'Dishwashers' },
      { name: 'Air Conditioners' },
      { name: 'Fans' },
      { name: 'Vacuum Cleaners' },
      { name: 'Air Purifiers' },
      { name: 'Coffee Makers' },
      { name: 'Blenders' },
      { name: 'Air Fryers' },
      { name: 'Other Appliances' }
    ]
  },
  {
    name: 'Garden & Outdoor',
    children: [
      { name: 'Lawn Mowers' },
      { name: 'Trimmers' },
      { name: 'Leaf Blowers' },
      { name: 'Gardening Tools' },
      { name: 'Plants' },
      { name: 'Planters' },
      { name: 'Outdoor Furniture' },
      { name: 'Grills & BBQ' },
      { name: 'Fire Pits' },
      { name: 'Pools' },
      { name: 'Outdoor Decor' },
      { name: 'Patio Equipment' }
    ]
  },
  {
    name: 'Computers & Office',
    children: [
      {
        name: 'Office',
        children: ['Desks', 'Office Chairs', 'Filing Cabinets', 'Shelving', 'Office Supplies']
      },
      {
        name: 'Printing',
        children: ['Printers', 'Scanners', 'Label Printers', 'Shredders']
      },
      {
        name: 'Business Equipment',
        children: ['POS Systems', 'Barcode Scanners', 'Commercial Printers', 'Office Electronics']
      }
    ]
  },
  {
    name: 'Handmade',
    children: [
      { name: 'Handmade Jewelry' },
      { name: 'Handmade Clothing' },
      { name: 'Handmade Bags' },
      { name: 'Handmade Home Decor' },
      { name: 'Handmade Furniture' },
      { name: 'Handmade Art' },
      { name: 'Handmade Toys' },
      { name: 'Handmade Gifts' },
      { name: 'Crafts' },
      { name: 'Custom Products' },
      { name: 'Personalized Products' }
    ]
  },
  {
    name: 'Antiques & Vintage',
    children: [
      { name: 'Vintage Clothing' },
      { name: 'Vintage Furniture' },
      { name: 'Vintage Electronics' },
      { name: 'Vintage Jewelry' },
      { name: 'Vintage Watches' },
      { name: 'Vintage Toys' },
      { name: 'Vintage Home Decor' },
      { name: 'Antique Furniture' },
      { name: 'Antique Collectibles' },
      { name: 'Antique Jewelry' },
      { name: 'Historical Items' },
      { name: 'Retro Items' }
    ]
  },
  {
    name: 'Business & Commercial',
    children: [
      { name: 'Restaurant Equipment' },
      { name: 'Retail Equipment' },
      { name: 'Office Equipment' },
      { name: 'Commercial Kitchen Equipment' },
      { name: 'Industrial Equipment' },
      { name: 'Construction Equipment' },
      { name: 'Salon & Beauty Equipment' },
      { name: 'Display Fixtures' },
      { name: 'Vending Machines' },
      { name: 'Business Supplies' }
    ]
  },
  {
    name: 'Real Estate',
    children: [
      {
        name: 'For Sale',
        children: ['Houses', 'Apartments', 'Condos', 'Townhomes', 'Multi-Family', 'Land', 'Commercial Property']
      },
      {
        name: 'For Rent',
        children: ['Houses', 'Apartments', 'Rooms', 'Condos', 'Townhomes', 'Commercial Rentals']
      },
      {
        name: 'Other',
        children: ['Vacation Rentals', 'Parking', 'Storage', 'Land']
      }
    ]
  },
  {
    name: 'Free & Giveaway',
    children: [
      { name: 'Free Furniture' },
      { name: 'Free Electronics' },
      { name: 'Free Clothing' },
      { name: 'Free Baby Items' },
      { name: 'Free Home Goods' },
      { name: 'Free Appliances' },
      { name: 'Free Building Materials' },
      { name: 'Free Miscellaneous' }
    ]
  },
  {
    name: 'Other',
    children: [
      { name: 'Other Items' }
    ]
  }
];

const createSlugFromName = (name) =>
  slugify(name, { lower: true, strict: true });

async function seedCategories() {
  console.log('🌱 Starting Categories Seed (Stable & Determinstic IDs)...');

  // We DO NOT truncate categories directly in supabase JS to prevent RLS conflicts.
  // Instead we run it via the script or upsert dynamically.
  // Wait, since we want to overwrite existing completely, let's truncate categories using a raw RPC if possible,
  // or we can deactivate all existing first, or delete them:
  console.log('Clearing old categories...');
  const { error: clearError } = await supabase
    .from('categories')
    .delete()
    .neq('name', '___NON_EXISTENT___'); // Delete all rows

  if (clearError) {
    console.error('Failed to clear old categories (might have product references):', clearError);
    console.log('Attempting to delete dependent tables...');
    // Clear dependent tables first
    await supabase.from('products').delete().neq('title', '___NON_EXISTENT___');
    await supabase.from('stores').delete().neq('store_name', '___NON_EXISTENT___');
    await supabase.from('categories').delete().neq('name', '___NON_EXISTENT___');
  }

  let totalSeeded = 0;

  for (let i = 0; i < categoryTree.length; i++) {
    const mainCat = categoryTree[i];
    const mainPath = mainCat.name.toLowerCase();
    const mainId = uuidv5(mainPath, NAMESPACE);
    const mainSlug = createSlugFromName(mainCat.name);

    console.log(`Inserting Main Category: ${mainCat.name} (UUID: ${mainId})`);
    
    const { error: mainError } = await supabase
      .from('categories')
      .upsert({
        id: mainId,
        name: mainCat.name,
        slug: mainSlug,
        parent_id: null,
        display_order: i + 1,
        is_active: true
      });

    if (mainError) {
      console.error(`Error inserting main category ${mainCat.name}:`, mainError);
      continue;
    }
    totalSeeded++;

    if (!mainCat.children) continue;

    for (let j = 0; j < mainCat.children.length; j++) {
      const subCat = mainCat.children[j];
      const subPath = `${mainPath}/${subCat.name.toLowerCase()}`;
      const subId = uuidv5(subPath, NAMESPACE);
      const subSlug = `${mainSlug}-${createSlugFromName(subCat.name)}`;

      console.log(`  └── Subcategory: ${subCat.name} (UUID: ${subId})`);

      const { error: subError } = await supabase
        .from('categories')
        .upsert({
          id: subId,
          name: subCat.name,
          slug: subSlug,
          parent_id: mainId,
          display_order: j + 1,
          is_active: true
        });

      if (subError) {
        console.error(`  Error inserting subcategory ${subCat.name}:`, subError);
        continue;
      }
      totalSeeded++;

      if (!subCat.children) continue;

      for (let k = 0; k < subCat.children.length; k++) {
        const leafCatName = subCat.children[k];
        const leafPath = `${subPath}/${leafCatName.toLowerCase()}`;
        const leafId = uuidv5(leafPath, NAMESPACE);
        const leafSlug = `${subSlug}-${createSlugFromName(leafCatName)}`;

        const { error: leafError } = await supabase
          .from('categories')
          .upsert({
            id: leafId,
            name: leafCatName,
            slug: leafSlug,
            parent_id: subId,
            display_order: k + 1,
            is_active: true
          });

        if (leafError) {
          console.error(`    Error inserting leaf category ${leafCatName}:`, leafError);
        } else {
          totalSeeded++;
        }
      }
    }
  }

  console.log(`\n🎉 Seed finished! Seeded ${totalSeeded} categories.`);
  process.exit(0);
}

seedCategories().catch((err) => {
  console.error('Fatal seed error:', err);
  process.exit(1);
});