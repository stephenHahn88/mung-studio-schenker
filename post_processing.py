# mapping of old -> new class names
CLASS_MAP = {
    "stem": "stemStructural",
    "noteheadFull": "noteheadBlack",
    "augmentationDot": "noteheadBlack",
    "slur": "slurStructuralUp",
    "tie": "slurStructuralUp",
    "beam": "beamStructural",
    "flag8thDown": "flagStructuralDown",
    "flag8thUp": "flagStructuralUp",
}

def replace_classnames(input_path, output_path):
    with open(input_path, "r", encoding="utf-8") as f:
        content = f.read()

    # Replace only full class names (avoid partial matches)
    for old, new in CLASS_MAP.items():
        content = content.replace(f'>{old}<', f'>{new}<')

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(content)

if __name__ == "__main__":
    input_file = "C:\\Users\\88ste\\PycharmProjects\\mung-studio-schenker\\simple-php-backend\\documents\\rachmaninov_bells_mvt2_p6\\mung.xml"
    output_file = input_file
    replace_classnames(input_file, output_file)
    print(f"Done! Saved to {output_file}")