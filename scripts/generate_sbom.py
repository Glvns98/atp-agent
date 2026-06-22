import os
import json
import time

def generate_sbom():
    print("Generating CycloneDX SBOM for ATP Gateway & SDK...")
    
    components = []
    
    # Python SDK requirements
    req_file = os.path.join(os.path.dirname(__file__), "..", "sdk", "requirements.txt")
    if os.path.exists(req_file):
        with open(req_file, "r") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#"):
                    parts = line.split("==")
                    if len(parts) >= 2:
                        name = parts[0].strip()
                        version_part = "==".join(parts[1:]).strip()
                        version = version_part.split()[0].replace("\\", "")
                        
                        component = {
                            "type": "library",
                            "name": name,
                            "version": version,
                            "purl": f"pkg:pypi/{name}@{version}"
                        }
                        
                        if "--hash=" in version_part:
                            hashes = []
                            for p in version_part.split():
                                if p.startswith("--hash="):
                                    hsh = p.split("--hash=")[1]
                                    algo, val = hsh.split(":")
                                    hashes.append({"alg": algo.upper(), "content": val})
                            component["hashes"] = hashes
                        components.append(component)

    sbom = {
        "bomFormat": "CycloneDX",
        "specVersion": "1.4",
        "version": 1,
        "metadata": {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "component": {
                "type": "application",
                "name": "ATP Gateway",
                "version": "2.0.0"
            }
        },
        "components": components
    }
    
    out_file = os.path.join(os.path.dirname(__file__), "..", "sbom.cdx.json")
    with open(out_file, "w") as f:
        json.dump(sbom, f, indent=2)
    
    print(f"SBOM successfully generated at {out_file}")

if __name__ == "__main__":
    generate_sbom()
