# Local Symbol Detector MuNG Studio

This local release does not require a sibling `Schenkerian_OMR` directory.
The Python backend reads local model files from `models/` and can run YOLO26L
or DETR detectors from the editor.

## Prerequisites

- Git
- Node.js 18 or newer
- Python 3.10 or newer

## Install

If you received a `.tar.gz` release package, extract it first:

```bash
tar -xzf mung-studio-yolo26-local.tar.gz
cd mung-studio-schenker
```

If the project has already been pushed to GitHub, you can clone it instead:

```bash
git clone -b yolo26-combined-local https://github.com/stephenHahn88/mung-studio-schenker.git
cd mung-studio-schenker
```

Then install dependencies:

```bash

npm install

python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements-yolo26.txt
```

On Windows, activate the virtual environment with:

```bat
.venv\Scripts\activate
```

## Add Model Files

Copy the model files you want to use into `models/`. The UI can show missing
models, but the run buttons are only enabled for models available on the
backend.

YOLO model weights:

```text
models/yolo26l_large_fullwidth_7pages_pre.pt
models/yolo26l_tiled_7pages_pre.pt
models/yolo26l_large_fullwidth_9pages_pre_ep300.pt
models/yolo26l_tiled_9pages_pre_ep300.pt
```

DETR model directories:

```text
models/detr_large_9pages_plus50/model/
models/detr_tiled_9pages_plus50/model/
```

The `Schenkerian_OMR` repository is not needed at runtime.

## Add Annotation Documents

Each document is a folder under `documents/`:

```text
documents/page_001/
  image.png
  mung.xml
```

The image file may be named `image.png`, `image.jpg`, or `image.jpeg`.
An empty `mung.xml` can start as:

```xml
<?xml version="1.0" encoding="utf-8"?>
<Nodes dataset="Schenkerian_OMR" document="page_001" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="CVC-MUSCIMA_Schema.xsd"></Nodes>
```

## Run

macOS/Linux:

```bash
source .venv/bin/activate
./start_local.sh
```

Windows:

```bat
.venv\Scripts\activate
start_local.bat
```

Open:

```text
http://localhost:1234
```

Use this Simple Backend token:

```text
123456789
```

In the editor, run:

```text
Recognition -> Run large, Run small, Run both, or select an area and run area recognition
```
