import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import dotenv from 'dotenv';
dotenv.config();

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
const resend = new Resend(process.env.RESEND_API_KEY);

async function test() {
  const email = "elorchi.dev@gmail.com";
  console.log(`Checking if user ${email} exists and generating link...`);

  const appUrl = process.env.APP_URL || 'http://localhost:8080';
  const { data: linkData, error } = await supabaseAdmin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo: `${appUrl}/auth/update-password` }
  });
  
  if (error) {
    console.error("Supabase Error:", error);
    return;
  }
  
  console.log("Supabase generated link successfully!");
  
  if (linkData?.properties?.action_link) {
    console.log("Sending email via Resend...");
    const { data: resendData, error: resendError } = await resend.emails.send({
      from: process.env.EMAIL_FROM || "DevReview AI <onboarding@resend.dev>",
      to: email,
      subject: "Reset your password for DevReview AI",
      html: `<p>Test Email: ${linkData.properties.action_link}</p>`,
    });

    if (resendError) {
      console.error("Resend Error:", resendError);
    } else {
      console.log("Resend Success! ID:", resendData?.id);
    }
  } else {
    console.log("No action_link returned from Supabase!");
  }
}

test();
