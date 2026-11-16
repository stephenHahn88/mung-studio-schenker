# Graph-to-JSON conversion

Converts an annotated page (MuNG file with symbols, syntax links, precedence links and time groups, and the page
image) into the JSON notation of Ni-Hahn et al. [1]: time position, pitch, voice and depth of every notehead.

## Install

Python 3.10 or newer.

```
pip install -r conversion/requirements.txt
```

## Usage

From the repository root:

```
python -m conversion conversion/example/mung.xml -o bach.json --report bach_report.json
python -m conversion dataset/pages/<page_id>/mung/relations.xml -o page.json
```

```python
from conversion import convert_page

result = convert_page("conversion/example/mung.xml")             # or convert_page(xml_path, image_path)
schenkernote_json = result["schenkernote"]
for note in result["notes"]:
    print(note["id"], note["time"], note["pitch"], note["voice"], note["depth"])
```

`--image` gives the page image; without it the converter looks next to the XML file for an image with the same name,
`original.*` or `image.*`, and for `image.*` one folder up. Only pages with a single grand staff (one G clef and one
F clef, both staves found on the image) are converted; other pages raise `conversion.ConversionError`.

## Input

A MuNG XML file in the format of [../dataset/ANNOTATION_SCHEME.md](../dataset/ANNOTATION_SCHEME.md) and the page
image in the pixel coordinates of its bounding boxes.

## Output

`-o` writes the JSON (`result["schenkernote"]`): `metadata`, `key`, `measureLines`, `noteConnections` and the lanes
`trebleNotes`, `innerTrebleNotes`, `innerBassNotes` and `bassNotes`, with one column per time position. `--report`
writes the other keys of `result`: `notes` (per notehead: id, class, time, pitch, voice, depth), `unresolved`
(noteheads that could not be written, with a code and a message), `warnings`, `details` and `summary`.

The JSON is typeset by the SchenkerNote software of [1], which is not included here; it is available from its
authors.

## Example

`example/` holds the page `bach_fugue_in_bb_minor_wtc_2_overview001` of the dataset (`mung.xml`, `image.jpg`) and its
output, written by

```
python -m conversion conversion/example/mung.xml -o conversion/example/expected.json --report conversion/example/expected_report.json
```

## Reference

[1] S. Ni-Hahn, W. Xu, J. Yin, R. Zhu, S. Mak, Y. Jiang and C. Rudin. A New Dataset, Notation Software, and
Representation for Computational Schenkerian Analysis. In Proceedings of the 25th International Society for Music
Information Retrieval Conference (ISMIR), 2024. https://arxiv.org/abs/2408.07184
