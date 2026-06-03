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

Add model files under `models/`. See [models/README.md](models/README.md) for
the exact file names.

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
