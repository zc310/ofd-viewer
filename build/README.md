# Build Directory

Wails 3 application metadata and file associations are defined in `config.yml`.
Platform build tasks are defined by `Taskfile.*.yml` files in this directory.

`appicon.png` is the source icon. Windows builds generate architecture-specific
`.syso` resources from `windows/icon.ico`, `windows/wails.exe.manifest`, and
`windows/info.json`. The NSIS installer continues to use the templates under
`windows/installer/`.
