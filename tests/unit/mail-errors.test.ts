import { describe, expect, it } from "vitest";
import { mailErrorCode } from "@/server/sending/mail-errors";

describe("mailErrorCode", () => {
  it("recognises the common mailbox problems", () => {
    expect(mailErrorCode("Invalid login: 534-5.7.9 Application-specific password required. For more information, go to 534 5.7.9 https://support.google.com/mail/?p=InvalidSecondFactor")).toBe("gmail_app_password");
    expect(mailErrorCode("Invalid login: 535-5.7.8 Username and Password not accepted.")).toBe("login_failed");
    expect(mailErrorCode("535 5.7.139 Authentication unsuccessful, basic authentication is disabled.")).toBe("outlook_basic_auth");
    expect(mailErrorCode("connect ETIMEDOUT 1.2.3.4:587")).toBe("connection_failed");
    expect(mailErrorCode("something odd")).toBe("other");
    expect(mailErrorCode(null)).toBeNull();
  });
});
