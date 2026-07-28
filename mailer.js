const nodemailer = require('nodemailer');
const path =require('path')
require('dotenv').config({path: './routes/.env'});

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

function sendVerificationEmail(toEmail, code) {
    return transporter.sendMail({
        from: `"Faisalabad Textile Depot" <${process.env.EMAIL_USER}>`,
        to: toEmail,
        subject: "Verify your account",
        text: `Your verification code is ${code}. It expires in 10 minutes.`,

        html: `
        <div style="font-family: Arial, sans-serif; background:#f6f1e7; padding:30px;">
            <div style="max-width:480px; margin:auto; background:#ffffff; padding:30px 26px; border-radius:14px; border:1px solid #e7e0d3;">

                <div style="text-align:center; margin-bottom: 18px;">
                    <span style="
                        display:inline-flex;
                        align-items:center;
                        justify-content:center;
                        width:34px;
                        height:34px;
                        background:#141414;
                        border-radius:6px;
                        color:#b3121c;
                        font-weight:800;
                        font-size:16px;
                        line-height:34px;
                    ">L</span>
                    <div style="font-size:18px; font-weight:800; color:#141414; margin-top:8px; letter-spacing:0.5px;">
                        Faisalabad Textile Store
                    </div>
                </div>

                <h2 style="text-align:center; color:#141414; font-size:19px; margin:0 0 14px;">Verify your email</h2>

                <p style="font-size:14px; color:#746f66; text-align:center; line-height:1.6; margin:0 0 22px;">
                    Use the code below to finish creating your account.
                </p>

                <div style="text-align:center; margin:25px 0;">
                    <span style="
                        display:inline-block;
                        font-size:26px;
                        letter-spacing:8px;
                        font-weight:800;
                        background:#faf7f0;
                        border:1px solid #e7e0d3;
                        padding:14px 20px;
                        border-radius:10px;
                        color:#b3121c;
                    ">
                        ${code}
                    </span>
                </div>

                <p style="font-size:13px; color:#746f66; text-align:center; margin:0;">
                    This code expires in <b style="color:#141414;">10 minutes</b>.
                </p>

                <hr style="border:none; border-top:1px solid #e7e0d3; margin:24px 0;">

                <p style="font-size:11px; color:#a39d8f; text-align:center; margin:0;">
                    If you didn't request this, you can safely ignore this email.
                </p>

            </div>
        </div>
        `
    });
}


module.exports = sendVerificationEmail;