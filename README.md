# PhD dashboard

Calibration séquentielle des prédictions de survie sous censure.
Données synthétiques, modèle calibré par construction et quatre méthodes comparées.

## Utilisation locale

```sh
python -m http.server 8000
```

Ouvrir <http://localhost:8000>. Les calculs tournent dans le navigateur ;
la première ouverture nécessite Internet pour charger Pyodide, NumPy et Plotly.

Pour exécuter le même moteur en Python :

```sh
pip install -r requirements.txt
python experiment.py
```

## Publication

GitHub Pages : branche `main`, dossier `/ (root)`.
Tous les chemins des fichiers locaux sont relatifs au dashboard.
