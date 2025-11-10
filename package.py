import shutil
import os
import subprocess
import tempfile

dist_dir = "dist"
out_name = "fracital.tapp.zip"
out_path = os.path.join(dist_dir, out_name)

if os.path.exists(out_path):
	os.remove(out_path)

format = input("Enter WebOS Format to compile as: (tb/anura): ")
with open("src/types.ts", "r", encoding="utf-8") as f:
    contents = f.read()
if format == "tb":
    contents = contents.replace('export const MusicPath = `/home/${sessionStorage.getItem("currAcc")}/Music/`;', 'export const MusicPath = `/home/${sessionStorage.getItem("currAcc")}/music/`;')
elif format == "anura":
	print("Anura isnt implemented yet but will be soon trust")
	exit(1)

npm_exe = shutil.which("npm") or shutil.which("npm.cmd")
if npm_exe:
	subprocess.run([npm_exe, "run", "build"], check=True)
else:
	subprocess.run("npm run build", check=True, shell=True)

if not os.path.isdir(dist_dir):
	os.makedirs(dist_dir, exist_ok=True)

with tempfile.TemporaryDirectory() as tmpdir:
	tmp_archive_base = os.path.join(tmpdir, "fracital.tapp")
	created = shutil.make_archive(tmp_archive_base, 'zip', dist_dir)
	shutil.move(created, out_path)

print("Finished compiling")
