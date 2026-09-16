const defaultSupportEmail = 'support@sportzonebd.com';

export interface EmailTemplateOptions {
  title: string;
  bodyText: string;
  code?: string;
  subInstruction?: string;
  link?: string;
  supportEmail?: string;
  year?: number;
  appName?: string;
}

const escapeHtml = (value: string): string => value.replace(/[&<>'"]/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  "'": '&#39;',
  '"': '&quot;',
}[character] ?? character));

const renderParagraphs = (bodyText: string): string => bodyText
  .split(/\r?\n+/)
  .filter(Boolean)
  .map((paragraph) => `<p style="margin:0 0 16px;color:#e2e8f0;font-size:15px;line-height:1.6;text-align:left;">${escapeHtml(paragraph)}</p>`)
  .join('');

export const getEmailTemplate = ({
  title,
  bodyText,
  code,
  subInstruction,
  link,
  supportEmail = defaultSupportEmail,
  year = new Date().getFullYear(),
  appName = 'SportZoneBD',
}: EmailTemplateOptions): string => {
  const safeSupportEmail = escapeHtml(supportEmail);
  const safeAppName = escapeHtml(appName);
  const codeMarkup = code
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:36px 0;color:#3b82f6;font-family:monospace;font-size:42px;font-weight:800;letter-spacing:12px;line-height:1.15;text-align:center;">${escapeHtml(code)}</td></tr></table>`
    : '';
  const instructionMarkup = subInstruction
    ? `<p style="margin:0 0 16px;color:#94a3b8;font-size:14px;line-height:1.6;text-align:left;">${escapeHtml(subInstruction)}</p>`
    : '';
  const linkMarkup = link
    ? `<p style="margin:24px 0 0;text-align:left;"><a href="${escapeHtml(link)}" style="display:inline-block;color:#ffffff;background:#3b82f6;border-radius:10px;padding:12px 18px;text-decoration:none;font-size:14px;font-weight:700;">Open SportZoneBD</a></p>`
    : '';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:20px 0;background:#0b0e14;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#0b0e14;">
    <tr><td align="center" style="padding:20px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:480px;background:#11141a;border-radius:12px;overflow:hidden;">
        <tr><td align="center" style="padding:28px 20px;background:#1e2638;color:#cbd5e1;font-size:28px;font-weight:700;line-height:1.2;text-align:center;">${safeAppName}</td></tr>
        <tr><td style="padding:32px 24px;text-align:left;">
          <h2 style="margin:0 0 16px;color:#3b82f6;font-size:22px;font-weight:700;line-height:1.25;text-align:left;">${escapeHtml(title)}</h2>
          ${renderParagraphs(bodyText)}
          ${codeMarkup}
          ${instructionMarkup}
          ${linkMarkup}
          <p style="margin:0;color:#94a3b8;font-size:14px;line-height:1.6;text-align:left;">Need help? <a href="mailto:${safeSupportEmail}" style="color:#3b82f6;text-decoration:none;">${safeSupportEmail}</a></p>
        </td></tr>
        <tr><td align="center" style="padding:24px 20px;background:#1a1d24;color:#64748b;font-size:13px;line-height:1.6;text-align:center;">&copy; ${year} ${safeAppName}. All rights reserved.</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
`;
};

export const getDynamicEmailTemplate = (subject: string, bodyContent: string): string => getEmailTemplate({
  title: subject,
  bodyText: bodyContent,
});

export const getRegistrationOtpTemplate = (otp: string): string => {
  if (!/^\d{6}$/.test(otp)) {
    throw new Error('Verification OTP must be exactly 6 digits');
  }

  return getEmailTemplate({
    title: 'Verify Your Account',
    bodyText: 'Thanks for signing up! Use the verification code below to complete your SportZoneBD registration. This code expires in 10 minutes.',
    code: otp,
    subInstruction: 'Enter this code on the verification page to activate your account.',
  });
};

export const getForgotPasswordTemplate = (otp: string): string => {
  if (!/^\d{6}$/.test(otp)) {
    throw new Error('Password reset OTP must be exactly 6 digits');
  }

  return getEmailTemplate({
    title: 'Password Reset Request',
    bodyText: 'We received a request to reset your password. Enter the verification code below to choose a new password. This code is valid for 10 minutes.',
    code: otp,
    subInstruction: 'Never share this code with anyone. If you did not request a password reset, ignore this email.',
  });
};

export const getPasswordResetTemplate = (): string => getEmailTemplate({
  title: 'Password Reset Successful',
  bodyText: 'Your SportZoneBD password was changed successfully.\nYou can now sign in using your new password. If you did not make this change, contact support immediately.',
});

export const getWelcomeEmailTemplate = (fullName: string): string => getEmailTemplate({
  title: `Congratulations, ${fullName}!`,
  bodyText: 'Your SportZoneBD account has been created successfully with Google.\nYou can now watch live matches, explore channels, save favorites, and follow the latest sports coverage.',
  subInstruction: 'If you did not create this account, please contact support.',
});