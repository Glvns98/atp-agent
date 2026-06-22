from setuptools import setup, find_packages

setup(
    name="atp-core",
    version="2.0.0",
    description="Attested Transport Protocol (ATP) Client SDK",
    author="ATP Open Standard",
    packages=find_packages(),
    install_requires=[
        "requests>=2.25.0",
        "certifi"
    ],
    entry_points={
        "console_scripts": [
            "atp=atp_core.cli:main",
        ],
    },
    classifiers=[
        "Programming Language :: Python :: 3",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
    ],
    python_requires=">=3.7",
)
