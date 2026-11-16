# Schenkerian Optical Music Recognition

Code, data and models of *A Novel Dataset and Framework for Schenkerian Optical Music Recognition*.

| Folder | Contents |
|---|---|
| `src/`, `simple-php-backend/`, [`docs/`](docs/) | MuNG Studio annotation tool with the model actions |
| [`dataset/`](dataset/README.md) | HandSchA: page images and MuNG annotations |
| [`experiments/symbol_recognition/`](experiments/symbol_recognition/README.md) | symbol detection |
| [`experiments/syntax_links/`](experiments/syntax_links/README.md) | syntax-link prediction |
| [`experiments/temporal_relations/`](experiments/temporal_relations/README.md) | time-group and precedence-link prediction |
| [`conversion/`](conversion/README.md) | graph-to-JSON conversion |
| [`models/`](models/README.md) | trained models |

## Annotation tool

This repository is a fork of [MuNG Studio](https://github.com/OmniOMR/mung-studio); its
[user manual](docs/user-manual/user-manual.md) applies. Requirements: Node.js 24 with npm, Python 3.10 or newer.

```bash
npm ci
pip install -r simple-php-backend/requirements.txt
./start_local.sh            # builds the frontend and serves it on http://localhost:8080 (token 123456789)
```

Pages are folders in `documents/` with an `image.jpg` (or `.png`) and a `mung.xml`. The model actions need the
models ([`models/README.md`](models/README.md)) and the settings in [`docs/model-actions.md`](docs/model-actions.md).

## Licenses

- Software: Apache License 2.0 ([`LICENSE`](LICENSE)).
- HandSchA (`dataset/` and the data folders of `experiments/`): [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/).
- Models: YOLOv8L weights AGPL-3.0 (Ultralytics); models trained on MUSCIMA++ CC BY-NC-SA 4.0.
- MUSCIMA++ and CVC-MUSCIMA are not redistributed.

## Citation

```bibtex
@misc{huang2026handscha,
  title  = {A Novel Dataset and Framework for Schenkerian Optical Music Recognition},
  author = {Huang, Yixuan and Yun, Xiao and Zheng, Jiayin and Mak, Simon and Jiang, Yue and Rudin, Cynthia and Ni-Hahn, Stephen},
  note   = {Submitted to ICDE 2027},
  year   = {2026}
}

@inproceedings{mungstudio,
  title     = {{MuNG Studio}: Annotation Tool for Music Notation Graph},
  author    = {Mayer, Ji{\v{r}}{\'\i} and Jebav{\'y}, Filip and Herz{\'a}nov{\'a} Vlkov{\'a}, Mark{\'e}ta and Dvo{\v{r}}{\'a}kov{\'a}, Martina and Pecina, Pavel and Haji{\v{c}}, Jr., Jan},
  booktitle = {Proceedings of the 12th International Conference on Digital Libraries for Musicology},
  pages     = {114--118},
  year      = {2025}
}
```
