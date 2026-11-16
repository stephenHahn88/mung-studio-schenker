import {
  Autocomplete,
  AutocompleteOption,
  ListItemContent,
  ListItemDecorator,
  Typography,
} from "@mui/joy";
import { SxProps } from "@mui/material";
import {
  MUNG_CLASS_NAMES,
  MUNG_CLASSES_BY_NAME,
  UNCERTAIN_CLASS_NAME,
} from "../../../mung/ontology/mungClasses";
import { classNameToUnicode } from "../../../mung/classNameToUnicode";
import {
  classNameToDisplayName,
  normalizeClassNameInput,
} from "../../../mung/classNameToDisplayName";

export interface ClassNameInputProps {
  readonly value?: string;
  readonly onChange?: (newValue: string) => void;
  readonly options?: readonly string[];
  readonly sx?: SxProps;
}

/**
 * UI Component for inputting node class names
 *
 * Based on:
 * https://mui.com/joy-ui/react-autocomplete/#option-appearance
 *
 * And also on:
 * https://mui.com/joy-ui/react-autocomplete/#users-created-option
 */
export function ClassNameInput(props: ClassNameInputProps) {
  // Put the review workflow class first so annotators do not have to know or
  // search for its canonical MuNG name (`unclassified`).
  const options = props.options ?? [
    UNCERTAIN_CLASS_NAME,
    ...MUNG_CLASS_NAMES.filter(
      (className) => className !== UNCERTAIN_CLASS_NAME,
    ),
  ];
  return (
    <Autocomplete
      value={props.value}
      onChange={(event, newClassName: string | null) => {
        props.onChange?.(
          newClassName === null ? "" : normalizeClassNameInput(newClassName),
        );
      }}
      options={options}
      autoHighlight
      autoComplete
      selectOnFocus
      clearOnBlur
      blurOnSelect
      handleHomeEndKeys
      freeSolo
      placeholder="Choose node class"
      sx={{ ...props.sx }}
      getOptionLabel={(className: string) => classNameToDisplayName(className)}
      slotProps={{
        input: {
          autoComplete: "new-password", // disable autocomplete and autofill
        },
      }}
      renderOption={({ key, ...props }: any, className: string) => (
        <AutocompleteOption key={key} {...props}>
          <ListItemDecorator>
            <span className="bravura">{classNameToUnicode(className)}</span>
          </ListItemDecorator>
          <ListItemContent sx={{ fontSize: "sm" }}>
            {classNameToDisplayName(className)}
            {className === UNCERTAIN_CLASS_NAME && (
              <Typography level="body-xs">
                Use when the final class needs review
              </Typography>
            )}
            {!MUNG_CLASSES_BY_NAME[className]?.isSmufl && (
              <Typography level="body-xs">(not a SMuFL class)</Typography>
            )}
          </ListItemContent>
        </AutocompleteOption>
      )}
    />
  );
}
