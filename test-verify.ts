import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function test() {
  const email = "elorchi.dev@gmail.com";
  
  // 1. Generate link
  const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo: 'http://localhost:8080' }
  });
  
  console.log("Hashed Token:", linkData?.properties?.hashed_token);
  
  // 2. Verify OTP
  const { data, error } = await supabaseAdmin.auth.verifyOtp({
    token_hash: linkData!.properties!.hashed_token,
    type: 'recovery'
  });
  
  console.log("Verify Error:", error);
  console.log("Verify Data User ID:", data?.user?.id);
  
  if (data?.user?.id) {
    // 3. Update password
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(data.user.id, {
       password: "newPassword123!"
    });
    console.log("Update Password Error:", updateError);
  }
}

test();
