# Local Symbol Detector Quick Start

For the complete setup and usage tutorial, read:

[docs/local-symbol-detector-guide.md](docs/local-symbol-detector-guide.md)

## Quick Start

Install dependencies:

```bash
npm install
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements-yolo26.txt
```

Download the model package from Google Drive:

```text
https://drive.google.com/file/d/1RsXbsR17CwZLJQ7G-Iiw7xSl3RtpcHZp/view?usp=drive_link
```

Unzip it in the repository root:

```bash
unzip ~/Downloads/mung-studio-symbol-detector-models.zip
```

After extraction, the repository should contain `models/`. See
[models/README.md](models/README.md) for the exact file names.

Add pages under `documents/`:

```text
documents/Page_Name/
  image.png
  mung.xml
```

Start the local app:

```bash
source .venv/bin/activate
./start_local.sh
```

Open:

```text
http://localhost:1234
```

Simple Backend token:

```text
123456789
```
