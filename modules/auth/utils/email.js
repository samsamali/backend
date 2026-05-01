const nodemailer = require("nodemailer");

function getTransporter() {
  return nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE || "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD,
    },
  });
}

/**
 * Send a password-reset OTP email.
 */
async function sendOTPEmail(toEmail, otp) {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>MarketSync – Password Reset</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { background:#0c0620; font-family:'Segoe UI',Helvetica,Arial,sans-serif; }
    .wrap { max-width:520px; margin:0 auto; padding:40px 20px; }
    .card {
      background: linear-gradient(160deg,#12083a,#1a0d50);
      border: 1px solid rgba(99,102,241,0.25);
      border-radius: 20px;
      padding: 48px 40px;
      box-shadow: 0 24px 64px rgba(0,0,0,0.5);
    }
    .logo { display:flex; align-items:center; gap:10px; margin-bottom:32px; }
    .logo-icon {
      width:40px; height:40px; border-radius:10px;
      background: linear-gradient(135deg,#6366f1,#a855f7);
      display:flex; align-items:center; justify-content:center;
      font-size:20px; line-height:40px; text-align:center;
    }
    .logo-text { font-size:20px; font-weight:800; color:#fff; letter-spacing:-0.02em; }
    .logo-text span { color:#a78bfa; }
    h1 { font-size:22px; font-weight:800; color:#fff; margin-bottom:10px; }
    .sub { font-size:14px; color:rgba(255,255,255,0.55); line-height:1.7; margin-bottom:32px; }
    .otp-box {
      background: rgba(99,102,241,0.12);
      border: 2px solid rgba(99,102,241,0.40);
      border-radius: 14px;
      text-align: center;
      padding: 28px 20px;
      margin-bottom: 32px;
    }
    .otp-label { font-size:11px; font-weight:700; color:#a78bfa; letter-spacing:0.12em; text-transform:uppercase; margin-bottom:10px; }
    .otp-code { font-size:42px; font-weight:900; color:#fff; letter-spacing:0.18em; font-family:monospace; }
    .otp-expires { font-size:12px; color:rgba(255,255,255,0.42); margin-top:10px; }
    .divider { border:none; border-top:1px solid rgba(255,255,255,0.08); margin:28px 0; }
    .note { font-size:12px; color:rgba(255,255,255,0.38); line-height:1.7; }
    .footer { margin-top:32px; text-align:center; font-size:11px; color:rgba(255,255,255,0.25); }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="logo">
        <div class="logo-icon">🔄</div>
        <div class="logo-text">Market<span>Sync</span></div>
      </div>

      <h1>Reset your password</h1>
      <p class="sub">
        We received a request to reset the password for your MarketSync account
        associated with <strong style="color:rgba(255,255,255,0.75)">${toEmail}</strong>.
        Use the OTP below to proceed.
      </p>

      <div class="otp-box">
        <div class="otp-label">Your One-Time Password</div>
        <div class="otp-code">${otp}</div>
        <div class="otp-expires">⏱ Expires in <strong>10 minutes</strong></div>
      </div>

      <hr class="divider"/>

      <p class="note">
        If you did not request a password reset, you can safely ignore this email.
        Your password will remain unchanged.<br/><br/>
        For security, never share this code with anyone. MarketSync will never ask you for your OTP.
      </p>
    </div>
    <div class="footer">
      © ${new Date().getFullYear()} MarketSync · All rights reserved
    </div>
  </div>
</body>
</html>
  `.trim();

  await getTransporter().sendMail({
    from: `"MarketSync" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: "MarketSync – Your Password Reset OTP",
    html,
  });
}

/**
 * Send a "not registered" notice when an unregistered email requests OTP.
 */
async function sendNotRegisteredEmail(toEmail) {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#0c0620;font-family:'Segoe UI',Helvetica,Arial,sans-serif}
    .wrap{max-width:520px;margin:0 auto;padding:40px 20px}
    .card{background:linear-gradient(160deg,#12083a,#1a0d50);border:1px solid rgba(99,102,241,0.25);border-radius:20px;padding:48px 40px;box-shadow:0 24px 64px rgba(0,0,0,0.5)}
    .logo{display:flex;align-items:center;gap:10px;margin-bottom:32px}
    .logo-icon{width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,#6366f1,#a855f7);text-align:center;line-height:40px;font-size:20px}
    .logo-text{font-size:20px;font-weight:800;color:#fff}
    .logo-text span{color:#a78bfa}
    h1{font-size:20px;font-weight:800;color:#fff;margin-bottom:10px}
    .sub{font-size:14px;color:rgba(255,255,255,0.55);line-height:1.75;margin-bottom:28px}
    .action-box{background:rgba(99,102,241,0.10);border:1px solid rgba(99,102,241,0.28);border-radius:14px;padding:22px 24px;margin-bottom:28px}
    .action-box p{font-size:14px;color:rgba(255,255,255,0.65);line-height:1.7}
    .btn{display:inline-block;background:linear-gradient(135deg,#6366f1,#a855f7);color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 28px;border-radius:10px;margin-top:16px}
    .footer{margin-top:32px;text-align:center;font-size:11px;color:rgba(255,255,255,0.25)}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="logo">
        <div class="logo-icon">🔄</div>
        <div class="logo-text">Market<span>Sync</span></div>
      </div>
      <h1>Password reset request received</h1>
      <p class="sub">
        We received a password reset request for
        <strong style="color:rgba(255,255,255,0.80)">${toEmail}</strong>,
        but this email address is not registered with MarketSync.
      </p>
      <div class="action-box">
        <p>
          If you meant to reset your password, make sure you're using the exact email
          you signed up with. If you don't have an account yet, you can create one for free.
        </p>
        <a class="btn" href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/signup">
          Create a Free Account →
        </a>
      </div>
      <p style="font-size:12px;color:rgba(255,255,255,0.35)">
        If you did not make this request, you can safely ignore this email.
      </p>
    </div>
    <div class="footer">© ${new Date().getFullYear()} MarketSync · All rights reserved</div>
  </div>
</body>
</html>`.trim();

  await getTransporter().sendMail({
    from: `"MarketSync" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: "MarketSync – Password Reset Request",
    html,
  });
}

module.exports = { sendOTPEmail, sendNotRegisteredEmail };
