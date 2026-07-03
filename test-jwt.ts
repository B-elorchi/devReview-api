import { createClient } from '@supabase/supabase-js';
import { jwtVerify } from 'jose';
import dotenv from 'dotenv';
dotenv.config();

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function test() {
  const email = "test_jwt@example.com";
  await supabaseAdmin.auth.admin.createUser({ email, password: "password123", email_confirm: true });
  
  const { data } = await supabaseAdmin.auth.signInWithPassword({ email, password: "password123" });
  const token = data.session?.access_token;
  
  if (!token) {
    console.log("No token generated!");
    return;
  }
  
  try {
    const secretStr = process.env.SUPABASE_JWT_SECRET!;
    console.log("Secret string:", secretStr.substring(0, 10) + "...");
    const secret = new TextEncoder().encode(secretStr);
    
    await jwtVerify(token, secret, { algorithms: ["HS256"] });
    console.log("JWT Verified successfully with TextEncoder!");
  } catch (err: any) {
    console.error("JWT Verify Failed with TextEncoder:", err.message);
  }
  
  await supabaseAdmin.auth.admin.deleteUser(data.user!.id);
}

test();
