#!/bin/sh
set -eu

uuid=latigo-escritorio@codex.local
case ${XDG_DATA_HOME:-} in
    /*) data_dir=$XDG_DATA_HOME ;;
    *) data_dir=${HOME:?}/.local/share ;;
esac
extension_dir=$data_dir/gnome-shell/extensions/$uuid

if [ -L "$extension_dir" ]; then
    printf 'La ruta de instalación %s es un enlace simbólico.\n' "$extension_dir" >&2
    exit 1
fi

if [ ! -d "$extension_dir" ]; then
    printf '%s\n' 'Látigo de escritorio no está instalado para este usuario.'
    exit 0
fi

if command -v gnome-extensions >/dev/null 2>&1; then
    if ! gnome-extensions disable "$uuid" 2>/dev/null; then
        printf '%s\n' 'Si el botón sigue visible, cierra sesión y vuelve a entrar.'
    fi
fi

for file in metadata.json extension.js physics.js stylesheet.css latigazo.oga latigo-symbolic.svg; do
    if [ -f "$extension_dir/$file" ] || [ -L "$extension_dir/$file" ]; then
        rm -- "$extension_dir/$file"
    fi
done

if [ ! -L "$extension_dir/schemas" ] && [ -d "$extension_dir/schemas" ]; then
    for file in org.gnome.shell.extensions.latigo-escritorio.gschema.xml gschemas.compiled; do
        if [ -f "$extension_dir/schemas/$file" ] || [ -L "$extension_dir/schemas/$file" ]; then
            rm -- "$extension_dir/schemas/$file"
        fi
    done
    rmdir -- "$extension_dir/schemas" 2>/dev/null || true
fi
rmdir -- "$extension_dir" 2>/dev/null || true
printf '%s\n' 'Látigo de escritorio desinstalado.'
