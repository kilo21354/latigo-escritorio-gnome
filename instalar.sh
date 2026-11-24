#!/bin/sh
set -eu

uuid=latigo-escritorio@codex.local
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
case ${XDG_DATA_HOME:-} in
    /*) data_dir=$XDG_DATA_HOME ;;
    *) data_dir=${HOME:?}/.local/share ;;
esac
extension_dir=$data_dir/gnome-shell/extensions/$uuid

if ! command -v gnome-extensions >/dev/null 2>&1 || ! command -v glib-compile-schemas >/dev/null 2>&1; then
    printf '%s\n' 'Abre una sesión de GNOME Shell para instalar la extensión.' >&2
    exit 1
fi

if [ -L "$extension_dir" ]; then
    printf 'La ruta de instalación %s es un enlace simbólico.\n' "$extension_dir" >&2
    exit 1
fi

if [ -L "$extension_dir/schemas" ] || { [ -e "$extension_dir/schemas" ] && [ ! -d "$extension_dir/schemas" ]; }; then
    printf 'La ruta %s no se puede usar como carpeta de esquemas.\n' "$extension_dir/schemas" >&2
    exit 1
fi

check_destination() {
    if [ -L "$1" ] || { [ -e "$1" ] && [ ! -f "$1" ]; }; then
        printf 'La ruta %s no se puede usar como archivo de la extensión.\n' "$1" >&2
        exit 1
    fi
}

set -- latigazo.oga latigo-symbolic.svg schemas/org.gnome.shell.extensions.latigo-escritorio.gschema.xml \
    stylesheet.css physics.js extension.js metadata.json
for file do
    if [ ! -f "$source_dir/$file" ] || [ ! -r "$source_dir/$file" ]; then
        printf 'El archivo %s falta o no se puede leer.\n' "$source_dir/$file" >&2
        exit 1
    fi

    check_destination "$extension_dir/$file"
done
check_destination "$extension_dir/schemas/gschemas.compiled"

compiled_dir=$(mktemp -d)
trap 'rm -f -- "$compiled_dir/gschemas.compiled"; rmdir -- "$compiled_dir"' EXIT
glib-compile-schemas --strict --targetdir="$compiled_dir" "$source_dir/schemas"

install -d -- "$extension_dir/schemas"
install -m 0644 -- "$compiled_dir/gschemas.compiled" "$extension_dir/schemas/gschemas.compiled"
for file do
    install -m 0644 -- "$source_dir/$file" "$extension_dir/$file"
done

if gnome-extensions enable "$uuid" 2>/dev/null; then
    printf '%s\n' 'Látigo de escritorio instalado. El icono de la barra superior y Ctrl+Alt+W pausan y reanudan el efecto.'
else
    printf '%s\n' 'Látigo de escritorio instalado. Cierra sesión y, al volver a entrar, ejecuta este comando.'
    printf '  gnome-extensions enable %s\n' "$uuid"
fi
