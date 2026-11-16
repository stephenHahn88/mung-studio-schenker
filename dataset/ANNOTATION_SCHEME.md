# HandSchA annotation scheme

Each page is a Music Notation Graph (MuNG) in `pages/<page_id>/mung/`. Every symbol is a `<Node>` with a class label
(`ClassName`) and a bounding box (`Left`, `Top`, `Width`, `Height`, in pixels of the page image).

## Classes

The 128 symbol classes, by family.

### Noteheads

| Class | Description |
|---|---|
| `noteheadBlack` | filled notehead |
| `noteheadHalf` | open (hollow) notehead |

### Structural stems and flags

| Class | Description |
|---|---|
| `flagStructuralDown` | flag on a structural stem, drawn on a downward stem |
| `flagStructuralUp` | flag on a structural stem, drawn on an upward stem |
| `stemStructural` | structural stem: stem of a note in the analytical graph |

### Conventional flags

| Class | Description |
|---|---|
| `flag16thUp` | sixteenth-note flag (common notation), up |
| `flag8thDown` | eighth-note flag (common notation), down |
| `flag8thUp` | eighth-note flag (common notation), up |

### Structural beams

| Class | Description |
|---|---|
| `beamStructural` | beam joining structural stems |
| `beamStructuralPartialLeft` | segment of a structural beam: left part |
| `beamStructuralPartialLeftDashed` | dashed left segment of a structural beam |
| `beamStructuralPartialMiddle` | segment of a structural beam: middle part |
| `beamStructuralPartialMiddleDashed` | dashed middle segment of a structural beam |
| `beamStructuralPartialRight` | segment of a structural beam: right part |

### Unfoldings and voice exchanges

| Class | Description |
|---|---|
| `beamStructuralUnfoldingDown` | diagonal beam of an unfolding, falling |
| `beamStructuralUnfoldingUp` | diagonal beam of an unfolding, rising |
| `voiceExchangeDown` | diagonal line of a voice exchange, falling |
| `voiceExchangeUp` | diagonal line of a voice exchange, rising |
| `voiceExchangeUpDashed` | dashed diagonal line of a voice exchange, rising |

### Structural slurs

| Class | Description |
|---|---|
| `slurStructuralDown` | analytical slur that curves downward |
| `slurStructuralDownDashed` | dashed analytical slur that curves downward |
| `slurStructuralUp` | analytical slur that curves upward |
| `slurStructuralUpDashed` | dashed analytical slur that curves upward |

### Accidentals

| Class | Description |
|---|---|
| `accidentalDoubleFlat` | double flat |
| `accidentalDoubleSharp` | double sharp |
| `accidentalFlat` | flat |
| `accidentalNatural` | natural |
| `accidentalParensLeft` | left parenthesis around an accidental |
| `accidentalParensRight` | right parenthesis around an accidental |
| `accidentalSharp` | sharp |

### Implied notes

| Class | Description |
|---|---|
| `parensImpliedLeft` | left parenthesis enclosing an implied note |
| `parensImpliedRight` | right parenthesis enclosing an implied note |

### Staff, clefs and key signatures

| Class | Description |
|---|---|
| `brace` | brace joining staves of a system |
| `fClef` | F (bass) clef |
| `gClef` | G (treble) clef |
| `keySignature` | key signature |
| `legerLine` | ledger line |
| `staffLine` | staff line |

### Barlines, voltas and measure numbers

| Class | Description |
|---|---|
| `barline` | single barline |
| `barlineDashed` | dashed barline |
| `barlineFinal` | final barline |
| `barlineHeavy` | heavy barline |
| `barlineStructuralDotted` | dotted analytical barline across the system |
| `barlineStructuralDottedPartial` | dotted analytical barline across part of the system |
| `circleMeasureNumber` | circle drawn around a measure number |
| `DoubleBarline` | double barline |
| `measureNumber` | measure number |
| `volta` | volta (ending) bracket |

### Harmonic analysis

| Class | Description |
|---|---|
| `analysisPivot` | pivot mark |
| `analyticalMinus` | minus sign in an analytical label |
| `analyticalPlus` | plus sign in an analytical label |
| `analyticalV` | Roman numeral V (older class name) |
| `figuredBassText` | figured-bass figures |
| `keyAnalysis` | key label (key in the text_transcription DataItem, if given) |
| `numeralRomanI` | Roman numeral I |
| `numeralRomanII` | Roman numeral II |
| `numeralRomanIII` | Roman numeral III |
| `numeralRomanIV` | Roman numeral IV |
| `numeralRomanV` | Roman numeral V |
| `numeralRomanVI` | Roman numeral VI |
| `numeralRomanVII` | Roman numeral VII |
| `secondaryHarmony` | label of a secondary (applied) harmony |
| `secondaryHarmonyArrowRight` | arrow marking a secondary (applied) harmony |
| `tonicizationBar` | horizontal bar over the span of a tonicization |

### Key labels with the key in the class name

| Class | Description |
|---|---|
| `keyAnalysisAM` | key label A major |
| `keyAnalysisAm` | key label A minor |
| `keyAnalysisBfM` | key label B-flat major |
| `keyAnalysisBfm` | key label B-flat minor |
| `keyAnalysisBm` | key label B minor |
| `keyAnalysisBM` | key label B major |
| `keyAnalysisCM` | key label C major |
| `keyAnalysisDfM` | key label D-flat major |
| `keyAnalysisDM` | key label D major |
| `keyAnalysisDm` | key label D minor |
| `keyAnalysisEfM` | key label E-flat major |
| `keyAnalysisEM` | key label E major |
| `keyAnalysisEm` | key label E minor |
| `keyAnalysisFM` | key label F major |
| `keyAnalysisFm` | key label F minor |
| `keyAnalysisGM` | key label G major |
| `keyAnalysisGm` | key label G minor |

### Scale degrees and numerals

| Class | Description |
|---|---|
| `numeral1` | Arabic numeral 1 |
| `numeral2` | Arabic numeral 2 |
| `numeral3` | Arabic numeral 3 |
| `numeral4` | Arabic numeral 4 |
| `numeral5` | Arabic numeral 5 |
| `numeral6` | Arabic numeral 6 |
| `numeral7` | Arabic numeral 7 |
| `numeral9` | Arabic numeral 9 |
| `scaleDegreeMark` | caret over a scale-degree numeral |

### Other analytical marks

| Class | Description |
|---|---|
| `analysisInterruption` | interruption sign |
| `braceAnalytical` | analytical brace grouping events |
| `formAntecedent` | label of an antecedent phrase |
| `formConsequent` | label of a consequent phrase |
| `glissando` | glissando line |
| `misalignment` | mark labelled as a misalignment |
| `motiveBox` | box drawn around a motive |
| `motiveBracket` | bracket marking a motive |
| `otherAnalytical` | analytical mark not covered by another class |

### Text and characters

| Class | Description |
|---|---|
| `characterApostrophe` | apostrophe |
| `characterCapitalA` | capital letter A |
| `characterCapitalB` | capital letter B |
| `characterCapitalC` | capital letter C |
| `characterCapitalD` | capital letter D |
| `characterCapitalE` | capital letter E |
| `characterCapitalF` | capital letter F |
| `characterCapitalG` | capital letter G |
| `characterCapitalS` | capital letter S |
| `characterCapitalX` | capital letter X |
| `characterCapitalY` | capital letter Y |
| `characterCapitalZ` | capital letter Z |
| `characterEqual` | equals sign |
| `characterExclamation` | exclamation mark |
| `characterForwardSlash` | forward slash |
| `characterHyphen` | hyphen or dash |
| `characterOther` | other single character |
| `characterSmallA` | lower-case letter a |
| `characterSmallB` | lower-case letter b |
| `characterSmallC` | lower-case letter c |
| `characterSmallD` | lower-case letter d |
| `characterSmallE` | lower-case letter e |
| `characterSmallF` | lower-case letter f |
| `characterSmallG` | lower-case letter g |
| `characterSmallI` | lower-case letter i |
| `characterSmallZ` | lower-case letter z |
| `interpretationText` | interpretive text (for example a section or form label) |
| `otherNumericSign` | numeric sign not covered by the numeral classes |
| `otherText` | other text (titles, words, annotations) |

The files also contain the labels `unclassified`, `unknown` and `unKnown` (symbol whose class was not decided),
`motivebracket` (spelling variant of `motiveBracket`) and `numeral8`, which are not among the 128 classes.

## Syntax links

Syntax links are the MuNG `Outlinks` and `Inlinks` of each node; a link A -> B has source A and target B.

- For most links we follow the syntax and precedence conventions of the OmniOMR annotation guidelines
  ([Annotation Instructions for MuNG 2.0](https://github.com/OmniOMR/mung/blob/68151e2eaae2fe11233634343a7f7bf53fea1c6d/docs/annotation-instructions/annotation-instructions.md)).
- Roman numeral analysis and linear progressions are handled like lyrics in standard MuNG: a notehead links to the
  Roman numeral (`numeralRoman*`) or numeral (`numeral1` to `numeral9`) written under it, consecutive labels are
  joined by precedence links, and a scale-degree numeral links to its caret (`scaleDegreeMark`).
- Structural stems (`stemStructural`) link to the analytical symbols they mark: slurs, beams, the Roman numerals of
  the harmonic analysis and the numerals of linear progressions.

## Precedence links

A precedence link A -> B means that B follows A in its voice or structural level. It is stored as DataItems on both
nodes (space-separated node ids):

```xml
<DataItem key="precedence_outlinks" type="list[int]">37</DataItem>   <!-- on the source node A -->
<DataItem key="precedence_inlinks" type="list[int]">26</DataItem>    <!-- on the target node B -->
```

## Time groups

A time group is a set of noteheads that occur at the same time in the reduction. Every member notehead carries one
DataItem whose key is `schenker_time_group_v1_<group id>`; the noteheads with the same key form the group:

```xml
<DataItem key="schenker_time_group_v1_b9588623-58f1-4c98-afc5-ea02797d19be" type="str">{"version":1,"label":"Group 1","kind":"shared-time","provenance":"manual","createdAt":"2026-09-16T02:00:08.701Z","updatedAt":"2026-09-16T02:00:08.701Z"}</DataItem>
```

The value is JSON: `version` (1), `label` (display label in the tool), `kind` (`shared-time`), `provenance`
(`manual` for annotated groups), `createdAt` and `updatedAt` (edit timestamps).
