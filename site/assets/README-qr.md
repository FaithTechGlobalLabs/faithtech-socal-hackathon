# Regenerating qr.svg

qr.svg points to the production URL https://faithtech-socal-hackathon.vercel.app (regenerated 10/23).
When the final domain is set, regenerate (replace the URL):

    python3 -c "import segno; segno.make('https://faithtech-socal-hackathon.vercel.app', error='m').save('qr.svg', scale=10, border=2, dark='#16160C', light='#FFFFFF', xmldecl=False)"

Requires `pip install segno`. Alternative: `npx qrcode -t svg -o qr.svg "<URL>"`.
Keep the white background and 2-module quiet zone so it scans on the dark page.
