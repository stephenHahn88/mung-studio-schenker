# MuNG Studio

Try MuNG Studio at: https://ufallab.ms.mff.cuni.cz/~mayer/mung-studio

The MuNG format: https://github.com/OMR-Research/mung

The MUSCIMA++ v2.0 dataset: https://github.com/OMR-Research/muscima-pp/releases/tag/v2.0


## Documentation

- [User Manual](docs/user-manual/user-manual.md)
- [Local Symbol Detector Guide](docs/local-symbol-detector-guide.md)

Development documentation:

- [Folder structure](docs/folder-structure.md)
- [Architecture](docs/architecture.md)
- [Editor component](docs/editor-component.md)
- [Performance bottlenecks](docs/performance-bottlenecks.md)
- [Simple PHP backend](docs/simple-php-backend.md)
- [Pyodide Python Runtime](docs/pyodide-python-runtime.md)
- [WebGL Renderer](docs/webgl-renderer.md)
- [Development setup](docs/development-setup.md)


## Development

For local annotators using the symbol detector panel, see the
[Local Symbol Detector Guide](docs/local-symbol-detector-guide.md). The local
release only needs this repository plus local model files in `models/`; it does
not require a separate `Schenkerian_OMR` checkout.

Start the development frontend server:

```bash
# install dependencies from package-lock.json
npm ci

# run the development server
npm start

# see the development preview at http://localhost:1234
```

Optionally start the simple PHP backend server in another terminal:

```bash
cd simple-php-backend
php -S localhost:8080

# NOTE: you need to have the .env file present with this line in it,
# otherwise the frontend will not know where to connect to:
SIMPLE_PHP_BACKEND_URL=http://localhost:8080
```

To use the symbol detector recognizer from the editor menu, start the bundled
Python backend instead:

```bash
npm run start-yolo26-backend

# in .env
YOLO26_BACKEND_URL=http://localhost:8080
```

The backend expects model files under `models/`. See
[models/README.md](models/README.md) for the supported file names and optional
environment variable overrides.

Read the [Development Setup](docs/development-setup.md) documentation page to see how to develop, debug, and deploy the project.
