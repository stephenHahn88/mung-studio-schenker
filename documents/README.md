Pages served by the local backend (`simple-php-backend/server.py`) live here.

Each page is a directory with this shape:

```text
documents/page_001/
  image.jpg
  mung.xml
```

The image may be named `image.jpg`, `image.jpeg` or `image.png`; its pixel
coordinates are the coordinates of `mung.xml`. An optional `original.jpg`
holds the unprocessed scan. The backend creates the other files (workflow
status, review comments, daily backups, logs); see
[docs/python-backend.md](../docs/python-backend.md).

Everything in this folder except this README is ignored by git.
