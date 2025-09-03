# Panel Bus

Page: https://pouceheure.github.io/panel-bus/

## Station ID

The web application uses the ID station to get information about this station.

### Automatic Solution: Search Page

> Now you can use the search page, to find the station url: https://pouceheure.github.io/panel-bus/search.html

### Manual Solution

```html
# generic
<URL>/?stationID=<ID>
# github page
https://pouceheure.github.io/panel-bus/?stationID=<ID>
# change language (default = your navigator system language)
https://pouceheure.github.io/panel-bus/?stationID=<ID>&lang={fr,en}
```

- default ID: 31500 (= "Guy Denielou")
- find ID:
  - search the stop there: https://www.oise-mobilite.fr/ - section "Horaires" ;
  - once found, select the number at the end of the URL;

Compiègne Station IDS table -> [here](./doc/station_ids.md);


## Station Example List

- Guy Denielou: https://pouceheure.github.io/panel-bus/?stationID=31500
- DeLaidde: https://pouceheure.github.io/panel-bus/?stationID=31661
- Roger Couttolenc: https://pouceheure.github.io/panel-bus/?stationID=31608
- Port à Bateaux: https://pouceheure.github.io/panel-bus/?stationID=31706
- Centre Culturel: https://pouceheure.github.io/panel-bus/?stationID=31587
- Saint Côme Mémorial: https://pouceheure.github.io/panel-bus/?stationID=31657
- Gare Compiègne: https://pouceheure.github.io/panel-bus/?stationID=41434


## Data

Data source: [Oise Mobilité](https://www.oise-mobilite.fr/open-data), Etalab v2.0
