import os
import sys
import shutil
import compileall
import subprocess
from pathlib import Path


def main():
    root = Path(__file__).resolve().parent.parent
    dist_dir = root / "dist" / "OmniVoiceStudio"

    print("=" * 70)
    print("      DONG GOI OMNIVOICE STUDIO - MA HOA SANG BYTECODE (.PYC)")
    print("=" * 70)
    print(f"Thu muc dich: {dist_dir}")

    # 1. Prepare clean dist directory
    if dist_dir.exists():
        print("[1/6] Dang lam sach thu muc dist cu...")
        shutil.rmtree(dist_dir, ignore_errors=True)
    dist_dir.mkdir(parents=True, exist_ok=True)

    # 2. Build or verify frontend
    web_out = root / "web" / "out"
    if not (web_out / "index.html").exists():
        print("[2/6] Dang bien dich giao dien Next.js...")
        subprocess.run(["cmd.exe", "/c", "npm run build"], cwd=str(root / "web"), check=True)
    else:
        print("[2/6] Giao dien Next.js (web/out) da san sang.")

    dist_web_out = dist_dir / "web" / "out"
    dist_web_out.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(web_out, dist_web_out)

    # 3. Copy launcher and assets
    print("[3/6] Sao chep cac file khoi chay va tai nguyen...")
    files_to_copy = [
        "OmniVoiceStudio.exe",
        "app_icon.ico",
        "run_desktop.bat",
        "run_desktop_silent.vbs",
        "create_desktop_shortcut.bat",
    ]
    for fname in files_to_copy:
        src = root / fname
        if src.exists():
            shutil.copy2(src, dist_dir / fname)

    # Create empty folders
    (dist_dir / "voices").mkdir(exist_ok=True)
    (dist_dir / "outputs").mkdir(exist_ok=True)

    tools_dir = root / "tools"
    if tools_dir.exists():
        dist_tools = dist_dir / "tools"
        dist_tools.mkdir(exist_ok=True)
        for item in tools_dir.iterdir():
            if item.name != "package_app.py":
                if item.is_dir():
                    shutil.copytree(item, dist_tools / item.name)
                elif item.suffix == ".py":
                    # compile to pyc and do not copy .py
                    compileall.compile_file(str(item), force=True, legacy=True, quiet=1)
                    pyc_file = item.with_suffix(".pyc")
                    if pyc_file.exists():
                        shutil.copy2(pyc_file, dist_tools / pyc_file.name)
                        pyc_file.unlink()
                else:
                    shutil.copy2(item, dist_tools / item.name)

    # 4. Copy and compile omnivoice to .pyc (NO .PY FILES!)
    print("[4/6] Bien dich toan bo ma nguon omnivoice sang Bytecode .pyc...")
    dist_omnivoice = dist_dir / "omnivoice"
    shutil.copytree(root / "omnivoice", dist_omnivoice)

    # Compile all .py in dist_omnivoice to .pyc in legacy format (adjacent to .py)
    compileall.compile_dir(str(dist_omnivoice), force=True, legacy=True, quiet=1)

    # Delete all .py files in dist_omnivoice
    deleted_py_count = 0
    for py_file in list(dist_omnivoice.rglob("*.py")):
        py_file.unlink()
        deleted_py_count += 1

    # Delete all __pycache__ folders
    for pycache in list(dist_omnivoice.rglob("__pycache__")):
        shutil.rmtree(pycache, ignore_errors=True)

    print(f"       -> Da bien dich va XOA {deleted_py_count} file .py goc.")
    print(f"       -> Toan bo ma nguon chi con cac file nhi phan .pyc, hoan toan khong co text code!")

    # 5. Copy .venv environment
    print("[5/6] Sao chep moi truong chay Python (.venv) sang thu muc dist...")
    venv_src = root / ".venv"
    venv_dst = dist_dir / ".venv"
    if venv_src.exists():
        print("       (Dang copy .venv bang robocopy, vui long cho giay lat...)")
        cmd = f'robocopy "{venv_src}" "{venv_dst}" /E /NFL /NDL /NJH /NJS /nc /ns /np'
        subprocess.run(cmd, shell=True)
    else:
        print("[CANH BAO] Khong tim thay thu muc .venv goc!")

    # 6. Final verification
    print("[6/6] Kiem tra toan ven ban phan phoi...")
    remaining_py = list(dist_omnivoice.rglob("*.py"))
    remaining_pyc = list(dist_omnivoice.rglob("*.pyc"))
    print(f"       So luong file .py trong ban dist:  {len(remaining_py)} (Chuan: 0)")
    print(f"       So luong file .pyc trong ban dist: {len(remaining_pyc)} (Da bao ve)")

    if len(remaining_py) == 0:
        print("\n" + "=" * 70)
        print(" [THANH CONG] Goi phan phoi da san sang tai:")
        print(f" -> {dist_dir}")
        print(" Ban co the gui nguyen thu muc nay (hoac nen zip) cho nguoi dung.")
        print(" Nguoi dung chi can chay OmniVoiceStudio.exe ma KHONG HE XEM DUOC CODE!")
        print("=" * 70 + "\n")
    else:
        print("\n[CANH BAO] Van con file .py sot lai! Vui long kiem tra.")


if __name__ == "__main__":
    main()
