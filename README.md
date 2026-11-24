# Látigo de escritorio

Un látigo virtual que permanece visible junto al puntero encima de las aplicaciones mientras está activado. Al iniciar sesión queda pausado hasta que lo actives manualmente. La aplicación de debajo recibe los clics con normalidad.

## Instalación

Usa una sesión de escritorio con GNOME Shell 45 a 50, como Ubuntu con GNOME y Wayland. Abre una terminal en esta carpeta y ejecuta el instalador con tu usuario.

```sh
sh instalar.sh
```

Si GNOME aún no muestra el botón después de la primera instalación, cierra sesión, vuelve a entrar y ejecuta este comando.

```sh
gnome-extensions enable latigo-escritorio@codex.local
```

Si ya tenías instalada una versión anterior, vuelve a ejecutar el instalador. En Wayland, cierra sesión y vuelve a entrar para que GNOME cargue el código actualizado.

## Uso

1. Pulsa **Ctrl + Alt + W** o haz clic en el dibujo del látigo en la barra superior para activarlo. Usa el mismo control para pausarlo. El punto ámbar indica que está activo y el gris indica que está pausado.
2. Mueve el puntero para llevar el látigo. La cuerda sigue al mango con inercia y se balancea al frenar o cambiar de dirección. Un clic izquierdo inicia el latigazo y su sonido. La cuerda vuelve a enrollarse junto al cursor.

El complemento usa el volumen de **Efectos de sonido** de GNOME.

## Desinstalación

```sh
sh desinstalar.sh
```

## Licencia

GPL-2.0 o posterior. Consulta el texto de la licencia en [LICENSE](LICENSE).
