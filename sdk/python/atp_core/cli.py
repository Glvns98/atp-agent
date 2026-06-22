import argparse
import sys
import os
import platform
import subprocess
import requests

GITHUB_RELEASE_URL = "https://github.com/atp-standard/atp-engine/releases/latest/download"

def get_binary_name():
    system = platform.system().lower()
    arch = platform.machine().lower()
    if system == "windows":
        return "atp-engine-windows-amd64.exe"
    elif system == "darwin":
        if arch in ["arm64", "aarch64"]:
            return "atp-engine-darwin-arm64"
        return "atp-engine-darwin-amd64"
    else:
        return "atp-engine-linux-amd64"

def download_engine():
    bin_name = get_binary_name()
    bin_path = os.path.join(os.path.expanduser("~"), ".atp", bin_name)
    
    if os.path.exists(bin_path):
        return bin_path

    os.makedirs(os.path.dirname(bin_path), exist_ok=True)
    print(f"Downloading ATP Engine for {platform.system()}...")
    
    # Mocking the download since the repo isn't public yet
    # response = requests.get(f"{GITHUB_RELEASE_URL}/{bin_name}", stream=True)
    # with open(bin_path, 'wb') as f:
    #     for chunk in response.iter_content(chunk_size=8192):
    #         f.write(chunk)
    # os.chmod(bin_path, 0o755)
    
    print("Warning: ATP Engine is not yet published to GitHub Releases.")
    print("Please build it manually from the `engine/` directory using `go build`.")
    return None

def start_engine(args):
    bin_path = download_engine()
    if bin_path and os.path.exists(bin_path):
        print("Starting ATP Engine Proxy...")
        try:
            subprocess.run([bin_path])
        except KeyboardInterrupt:
            print("\nShutting down ATP Engine.")
    else:
        print("Could not start engine.")

def verify_report(args):
    if not os.path.exists(args.file):
        print(f"File not found: {args.file}")
        sys.exit(1)
        
    try:
        with open(args.file, 'r', encoding='utf-8') as f:
            content = f.read()
            
        print("Sending report to ATP Engine for mathematical verification...")
        res = requests.post("http://localhost:8081/v1/audit/verify_file", data=content.encode('utf-8'))
        
        if res.status_code == 200:
            data = res.json()
            if data.get('status') == 'valid':
                print("✅ VERIFIED: " + data.get('message', ''))
            else:
                print("❌ CORRUPTED: " + data.get('message', ''))
        else:
            print("❌ ERROR: ATP Engine not running or unreachable. Please run `atp start` first.")
    except Exception as e:
        print(f"Failed to verify report: {str(e)}")

def main():
    parser = argparse.ArgumentParser(description="ATP SDK Command Line Interface")
    subparsers = parser.add_subparsers(dest="command", help="Available commands")
    
    # Start Command
    start_parser = subparsers.add_parser("start", help="Starts the local ATP Engine proxy")
    start_parser.set_defaults(func=start_engine)
    
    # Verify Command
    verify_parser = subparsers.add_parser("verify", help="Mathematically verify an ATP Compliance Report (.md)")
    verify_parser.add_argument("file", help="Path to the .md report file")
    verify_parser.set_defaults(func=verify_report)
    
    args = parser.parse_args()
    if args.command is None:
        parser.print_help()
    else:
        args.func(args)

if __name__ == "__main__":
    main()
