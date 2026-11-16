# HandSchA

HandSchA is a dataset of 47 pages of handwritten Schenkerian analyses annotated as Music Notation Graphs (MuNG).

```
pages/<page_id>/
  image.<jpg|jpeg|png>   page image
  mung/symbols.xml       MuNG annotation of the symbols (all 47 pages)
  mung/relations.xml     MuNG annotation with syntax links, time groups and precedence links (pages where they are annotated)
```

Classes, link conventions and DataItem formats: [ANNOTATION_SCHEME.md](ANNOTATION_SCHEME.md).

License: [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/).

```bibtex
@misc{huang2026handscha,
  title  = {A Novel Dataset and Framework for Schenkerian Optical Music Recognition},
  author = {Huang, Yixuan and Yun, Xiao and Zheng, Jiayin and Mak, Simon and Jiang, Yue and Rudin, Cynthia and Ni-Hahn, Stephen},
  note   = {Submitted to ICDE 2027},
  year   = {2026}
}
```
