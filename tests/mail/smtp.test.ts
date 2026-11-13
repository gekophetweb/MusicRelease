import nodemailer from "nodemailer";
import { createSmtpTransport } from "@/mail/smtp";

vi.mock("nodemailer", () => {
  const sendMail = vi.fn().mockResolvedValue({ messageId: "<m1@example.com>" });
  const verify = vi.fn().mockResolvedValue(true);
  return { default: { createTransport: vi.fn(() => ({ sendMail, verify })) } };
});

const base = {
  provider: "smtp" as const,
  from: { email: "music@example.com", name: "Music" },
  host: "smtp.example.com",
  port: 587,
  user: "u",
  pass: "p",
};

beforeEach(() => vi.mocked(nodemailer.createTransport).mockClear());

test("starttls maps to secure:false + requireTLS:true", () => {
  createSmtpTransport({ ...base, security: "starttls" });
  expect(nodemailer.createTransport).toHaveBeenCalledWith(
    expect.objectContaining({ host: "smtp.example.com", port: 587, secure: false, requireTLS: true, auth: { user: "u", pass: "p" } }),
  );
});

test("tls maps to secure:true", () => {
  createSmtpTransport({ ...base, port: 465, security: "tls" });
  expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({ secure: true, requireTLS: false }));
});

test("no auth when user is empty", () => {
  createSmtpTransport({ ...base, security: "none", user: "", pass: "" });
  expect(vi.mocked(nodemailer.createTransport).mock.calls[0][0]).not.toHaveProperty("auth.user");
});

test("send passes from, to, subject, html, text and headers", async () => {
  const t = createSmtpTransport({ ...base, security: "starttls" });
  const res = await t.send({
    to: { email: "fan@example.com", name: "Fan" },
    subject: "Hi",
    html: "<b>Hi</b>",
    text: "Hi",
    headers: { "List-Unsubscribe": "<https://x/unsub>" },
  });
  const transport = vi.mocked(nodemailer.createTransport).mock.results[0].value;
  expect(transport.sendMail).toHaveBeenCalledWith({
    from: { address: "music@example.com", name: "Music" },
    to: { address: "fan@example.com", name: "Fan" },
    subject: "Hi",
    html: "<b>Hi</b>",
    text: "Hi",
    headers: { "List-Unsubscribe": "<https://x/unsub>" },
  });
  expect(res).toEqual({ id: "<m1@example.com>" });
});
