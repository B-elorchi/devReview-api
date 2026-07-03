import { Resend } from 'resend';
import dotenv from 'dotenv';
dotenv.config();

const resend = new Resend(process.env.RESEND_API_KEY);

async function test() {
  const { data, error } = await resend.emails.send({
    from: process.env.EMAIL_FROM || "DevReview AI <onboarding@resend.dev>",
    to: "test@example.com", // We just want to see if the FROM address is valid
    subject: "Test",
    html: "<p>Test</p>"
  });
  console.log("Error:", error);
  console.log("Data:", data);
}

test();
