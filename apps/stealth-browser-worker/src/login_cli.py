import argparse
import asyncio
import sys
from .login_flow import launch_interactive_login, PLATFORM_LOGIN_URLS

def main():
    parser = argparse.ArgumentParser(description="PolyPost Interactive Account Login Vault CLI")
    parser.add_argument("--account", required=True, help="Local account alias/ID (e.g. main_creator)")
    parser.add_argument("--platform", required=True, choices=list(PLATFORM_LOGIN_URLS.keys()), help="Target platform to authenticate")
    parser.add_argument("--timeout", type=int, default=300, help="Seconds to keep browser open waiting for login (default: 300)")
    parser.add_argument("--headless", action="store_true", help="Run in headless mode (default: headed UI)")
    args = parser.parse_args()

    print(f"\n[PolyPost Vault] Launching visible browser window for {args.platform}...")
    print(f"[PolyPost Vault] Account Alias: {args.account}")
    print("[PolyPost Vault] Log into your account and complete 2FA/CAPTCHA in the window.")
    print("[PolyPost Vault] Cookies and storage state will be saved automatically.\n")

    res = asyncio.run(
        launch_interactive_login(
            account_id=args.account,
            platform=args.platform,
            timeout_sec=args.timeout,
            headless=args.headless,
        )
    )

    if res.get("success"):
        print(f"\nSUCCESS: Session authenticated! Saved {res.get('cookie_count')} cookies to {res.get('state_path')}")
        sys.exit(0)
    else:
        print(f"\nSTATUS: {res.get('status')} - Cookies captured: {res.get('cookie_count')}")
        sys.exit(1)

if __name__ == "__main__":
    main()
