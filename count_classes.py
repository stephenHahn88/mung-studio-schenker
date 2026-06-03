import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path


def count_classes_and_edges_in_file(xml_path):
    """
    Count node classes and edges in a single MUNG XML file.

    Returns
    -------
    class_counter : Counter
        Counts of each node class.
    edge_count : int
        Number of edges in the file.
    node_count : int
        Number of nodes in the file.
    """

    class_counter = Counter()
    edge_count = 0
    node_count = 0

    try:
        tree = ET.parse(xml_path)
        root = tree.getroot()

        # Count nodes and classes
        for node in root.findall("Node"):
            node_count += 1

            class_name = node.find("ClassName")

            if class_name is not None and class_name.text:
                class_counter[class_name.text] += 1

            # Count edges from Inlinks / Outlinks
            outlinks = node.find("Outlinks")

            if outlinks is not None and outlinks.text:
                # Split on whitespace and remove empties
                links = [x for x in outlinks.text.split() if x.strip()]
                edge_count += len(links)

    except Exception as e:
        print(f"Error reading {xml_path}: {e}")

    return class_counter, edge_count, node_count


def count_classes_in_folder(folder_path, extension=".xml"):
    """
    Recursively search a folder for MUNG XML files and count:
      1. Counts per file
      2. Aggregate counts across all files
      3. Total edge counts

    Skips any file inside a folder named 'backups'.
    """

    folder = Path(folder_path)

    per_file_counts = {}
    total_counts = Counter()

    total_edges = 0
    total_nodes = 0

    # Recursively find XML files
    xml_files = list(folder.rglob(f"*{extension}"))

    # Remove anything inside a "backups" folder
    xml_files = [
        f for f in xml_files
        if "backups" not in [part.lower() for part in f.parts]
    ]

    print(f"Found {len(xml_files)} files (excluding backups folders).\n")

    for xml_file in xml_files:

        file_counts, edge_count, node_count = (
            count_classes_and_edges_in_file(xml_file)
        )

        per_file_counts[xml_file] = {
            "class_counts": file_counts,
            "edges": edge_count,
            "nodes": node_count,
        }

        total_counts.update(file_counts)
        total_edges += edge_count
        total_nodes += node_count

        # Print per-file summary
        print("=" * 60)
        print(f"FILE: {xml_file}")
        print("-" * 60)

        for class_name, count in sorted(file_counts.items()):
            print(f"{class_name:30s} {count}")

        print()
        print(f"Total nodes: {node_count}")
        print(f"Total edges: {edge_count}")
        print()

    # Print aggregate summary
    print("\n" + "=" * 60)
    print("AGGREGATE COUNTS ACROSS ALL FILES")
    print("=" * 60)

    for class_name, count in sorted(total_counts.items()):
        print(f"{class_name:30s} {count}")

    print("\n" + "-" * 60)
    print(f"Total unique classes: {len(total_counts)}")
    print(f"Total nodes overall: {total_nodes}")
    print(f"Total edges overall: {total_edges}")

    return per_file_counts, total_counts, total_edges


if __name__ == "__main__":

    folder_path = "simple-php-backend/documents/"

    per_file_counts, total_counts, total_edges = (
        count_classes_in_folder(folder_path)
    )

