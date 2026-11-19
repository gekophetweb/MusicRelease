import { connectErrorMessage } from "@/lib/connect-errors";

test("no error, no message", () => {
  expect(connectErrorMessage(undefined)).toBeNull();
  expect(connectErrorMessage("")).toBeNull();
});

test("explains a music account that belongs to another user", () => {
  expect(connectErrorMessage("account_already_linked_to_different_user")).toBe(
    "That music account is already connected to another user on this site. Sign in as that user, or ask the admin to remove it there.",
  );
});

test("explains cancelling at the music service", () => {
  expect(connectErrorMessage("access_denied")).toBe("Connecting was cancelled. Try again when you're ready.");
});

test("explains an expired sign-in during connecting", () => {
  expect(connectErrorMessage("unable_to_link_account")).toBe("Connecting didn't finish because your sign-in expired. Sign in again and retry.");
});

test("explains a refused profile lookup (Spotify listener not on the app's user list)", () => {
  expect(connectErrorMessage("unable_to_get_user_info")).toBe(
    "Connecting didn't finish because the music service wouldn't share your profile. On Spotify this usually means your account isn't on the site's list of allowed listeners: ask the admin to add the email you sign in to Spotify with.",
  );
});

test("anything else gets a generic message with the code", () => {
  expect(connectErrorMessage("invalid_code")).toBe("Connecting didn't finish (invalid_code). Try again.");
  expect(connectErrorMessage("link")).toBe("Connecting didn't finish. Try again.");
});

test("a repeated error param uses better-auth's code (the last one)", () => {
  expect(connectErrorMessage(["link", "access_denied"])).toBe("Connecting was cancelled. Try again when you're ready.");
});
