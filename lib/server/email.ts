import nodemailer from "nodemailer";

import { getEmailSmtpConfig } from "./auth-config";

export async function sendRegistrationVerificationEmail(
  email: string,
  code: string,
) {
  const config = await getEmailSmtpConfig();
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.auth,
  });

  await transport.sendMail({
    from: `Cyanyi Drama <${config.from}>`,
    to: email,
    subject: "Cyanyi Drama 邮箱验证码",
    text: `你的注册验证码是 ${code}，10 分钟内有效。若非本人操作，请忽略此邮件。`,
    html: [
      "<div style=\"font-family:Arial,'Microsoft YaHei',sans-serif;color:#171717;line-height:1.7\">",
      "<h2>验证你的邮箱</h2>",
      "<p>你正在注册 Cyanyi Drama，验证码为：</p>",
      `<p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p>`,
      "<p>验证码 10 分钟内有效。若非本人操作，请忽略此邮件。</p>",
      "</div>",
    ].join(""),
  });
}
