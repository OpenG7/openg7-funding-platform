#!/usr/bin/env bash

# Stop on errors, unset variables, and failed pipeline commands.
set -euo pipefail

ALIAS_NAME="vps"
ALIAS_COMMAND="ssh ubuntu@vps-8db0cb49.vps.ovh.ca"
ALIAS_LINE="alias ${ALIAS_NAME}='${ALIAS_COMMAND}'"

# Detect the user's preferred shell from $SHELL. This works for both login
# shells and most interactive terminal sessions.
detect_shell_config() {
  local shell_name

  shell_name="$(basename "${SHELL:-}")"

  case "$shell_name" in
    bash)
      printf '%s\n' "${HOME}/.bashrc"
      ;;
    zsh)
      printf '%s\n' "${HOME}/.zshrc"
      ;;
    *)
      printf 'Erreur: shell non pris en charge ou indetectable: %s\n' "${SHELL:-inconnu}" >&2
      printf 'Ce script prend en charge Bash et Zsh uniquement.\n' >&2
      exit 1
      ;;
  esac
}

CONFIG_FILE="$(detect_shell_config)"

# Ensure the target configuration file exists before reading or appending to it.
touch "$CONFIG_FILE"

# Do not add the alias if the exact same alias is already configured.
if grep -Fqx "$ALIAS_LINE" "$CONFIG_FILE"; then
  printf 'Alias "%s" deja present dans %s. Aucun changement necessaire.\n' "$ALIAS_NAME" "$CONFIG_FILE"
  exit 0
fi

# Avoid overwriting a user-defined alias with the same name but another command.
if grep -Eq "^[[:space:]]*alias[[:space:]]+${ALIAS_NAME}=" "$CONFIG_FILE"; then
  printf 'Erreur: un alias "%s" existe deja dans %s avec une valeur differente.\n' "$ALIAS_NAME" "$CONFIG_FILE" >&2
  printf 'Veuillez le modifier manuellement si vous souhaitez le remplacer.\n' >&2
  exit 1
fi

# Append the alias in a clearly marked block to keep the shell config readable.
{
  printf '\n'
  printf '# Alias VPS OVH ajoute automatiquement.\n'
  printf '%s\n' "$ALIAS_LINE"
} >> "$CONFIG_FILE"

printf 'Alias "%s" ajoute avec succes dans %s.\n' "$ALIAS_NAME" "$CONFIG_FILE"

# Reloading a shell configuration only affects the current process. This works
# when the script is sourced. If it is executed normally, print the command the
# user can run in the current terminal session.
if [[ "${BASH_SOURCE[0]}" != "$0" ]]; then
  # shellcheck disable=SC1090
  source "$CONFIG_FILE"
  printf 'Configuration rechargee automatiquement.\n'
else
  printf 'Pour utiliser l alias dans ce terminal, executez: source "%s"\n' "$CONFIG_FILE"
fi
