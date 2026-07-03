import { createClient } from '@supabase/supabase-js';
import { decodeProtectedHeader } from 'jose';
import dotenv from 'dotenv';
dotenv.config();

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function test() {
  const email = "test_jwt_2@example.com";
  await supabaseAdmin.auth.admin.createUser({ email, password: "password123", email_confirm: true });
  
  const { data } = await supabaseAdmin.auth.signInWithPassword({ email, password: "password123" });
  const token = data.session?.access_token;
  
  if (token) {
    const header = decodeProtectedHeader(token);
    console.log("JWT Header:", header);
  }
  
  await supabaseAdmin.auth.admin.deleteUser(data.user!.id);
}

test();
