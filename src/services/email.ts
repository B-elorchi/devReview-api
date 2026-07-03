import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY || "re_placeholder");

export const sendVerificationEmail = async (email: string, actionLink: string) => {
  if (!process.env.RESEND_API_KEY) {
    console.warn(`[Email Service] Mock Verification to ${email}: ${actionLink}`);
    return;
  }
  
  const { data, error } = await resend.emails.send({
    from: process.env.EMAIL_FROM || "DevReview AI <onboarding@resend.dev>",
    to: email,
    subject: "Verify your email address for DevReview AI",
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2>Welcome to DevReview AI!</h2>
        <p>Thanks for signing up. Please verify your email address by clicking the button below:</p>
        <div style="margin: 30px 0;">
          <a href="${actionLink}" style="background-color: #7c3aed; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Verify Email Address</a>
        </div>
        <p style="color: #666; font-size: 14px;">If the button doesn't work, copy and paste this link into your browser:</p>
        <p style="color: #666; font-size: 12px; word-break: break-all;">${actionLink}</p>
      </div>
    `,
  });

  if (error) {
    console.error(`[Email Service] Failed to send verification to ${email}:`, error);
  } else {
    console.log(`[Email Service] Sent verification to ${email} (ID: ${data?.id})`);
  }
};

export const sendPasswordResetEmail = async (email: string, actionLink: string) => {
  if (!process.env.RESEND_API_KEY) {
    console.warn(`[Email Service] Mock Password Reset to ${email}: ${actionLink}`);
    return;
  }
  
  const { data, error } = await resend.emails.send({
    from: process.env.EMAIL_FROM || "DevReview AI <onboarding@resend.dev>",
    to: email,
    subject: "Reset your password for DevReview AI",
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2>Password Reset Request</h2>
        <p>We received a request to reset your password. Click the button below to choose a new one:</p>
        <div style="margin: 30px 0;">
          <a href="${actionLink}" style="background-color: #7c3aed; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Reset Password</a>
        </div>
        <p style="color: #666; font-size: 14px;">If you didn't request this, you can safely ignore this email.</p>
        <p style="color: #666; font-size: 12px; word-break: break-all;">${actionLink}</p>
      </div>
    `,
  });

  if (error) {
    console.error(`[Email Service] Failed to send password reset to ${email}:`, error);
  } else {
    console.log(`[Email Service] Sent password reset to ${email} (ID: ${data?.id})`);
  }
};
