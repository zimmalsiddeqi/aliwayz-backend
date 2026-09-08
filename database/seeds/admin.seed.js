'use strict';

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function seedAdmin() {
  const email = process.env.ADMIN_DEFAULT_EMAIL || 'admin@aliwayz.com';
  const password = process.env.ADMIN_DEFAULT_PASSWORD || 'Admin123456!';
  const username = process.env.ADMIN_DEFAULT_USERNAME || 'admin';
  const fullName = 'Aliwayz System Admin';

  console.log(\?? Seeding default admin: \...\);

  const passwordHash = bcrypt.hashSync(password, 10);

  const adminData = {
    email,
    username,
    password_hash: passwordHash,
    full_name: fullName,
    role: 'admin',
    account_status: 'active',
    email_verified: true,
    phone_verified: true,
    auth_provider: 'email',
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('admins')
    .upsert(adminData, { onConflict: 'email' })
    .select('id, email, username, role')
    .single();

  if (error) {
    console.error('? Failed to seed admin:', error);
    process.exit(1);
  }

  console.log(\? Admin created/updated successfully:\);
  console.log(\   Email: \\);
  console.log(\   Username: \\);
  console.log(\   Role: \\);
  console.log(\   Password: \\);
  process.exit(0);
}

seedAdmin().catch((err) => {
  console.error('Admin seeding failed:', err);
  process.exit(1);
});
