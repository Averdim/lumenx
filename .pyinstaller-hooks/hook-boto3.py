# PyInstaller hook for boto3 / botocore (MinIO S3 client)

from PyInstaller.utils.hooks import collect_all

datas, binaries, hiddenimports = collect_all("boto3")
d2, b2, h2 = collect_all("botocore")
datas += d2
binaries += b2
hiddenimports += h2
