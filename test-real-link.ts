import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function test() {
  const email = "realtestuser@example.com";
  
  // 1. Create a user
  await supabaseAdmin.auth.admin.createUser({
    email,
    password: "password123",
    email_confirm: true
  });

  // 2. Generate link
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo: 'http://localhost:8080/auth/update-password' }
  });
  
  console.log("Error:", error);
  console.log("Data properties:", data?.properties);
  
  // 3. Cleanup
  if (data?.user?.id) {
    await supabaseAdmin.auth.admin.deleteUser(data.user.id);
  }
}

test();
