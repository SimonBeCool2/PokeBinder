$(document).ready(() => {
    let socket;
    
    function connectWebSocket() {
        socket = new WebSocket('ws://localhost');

        socket.onopen = () => {
            console.log('[CLIENT] WebSocket verbunden.');
            if (localStorage.getItem('updatingCatalog') === 'true') {
                $('#loading-bar, #overlay').show();
            }
        };

        socket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'updateItems') {
                loadItems(data.items);
            } else if (data.type === 'priceUpdate') {
                $('#overlay').show();
                $('#current-item-name').text(data.item.name);
                $('#current-item-price').text(data.item.price);
            }
        };

        socket.onclose = () => {
            console.log('[CLIENT] Verbindung verloren. Versuche erneut...');
            setTimeout(connectWebSocket, 2000);
        };
    }

    connectWebSocket();

    function loadItems(items) {
        $('#item-list').empty();
        items.forEach((item, index) => {
            $('#item-list').append(`
                <li data-index="${index}">
                    <div class="item">
                        <img src="${item.image}" alt="Item Image">
                        <div class="details">
                            <h3>${item.name}</h3>
                            <p>Preis: ${item.price}€</p>
                            <p>Auf Lager: ${item.in_stock}</p>
                            <p>Gekauft für: ${item.buyed}€</p>
                            <a href="${item.link}" target="_blank">Ansehen</a>
                        </div>
                        <div class="actions">
                            <span class="material-icons edit-item">edit</span>
                            <span class="material-icons delete-item">delete</span>
                        </div>
                    </div>
                </li>
            `);
        });
    }

    $('#batch-item-form').submit(function (event) {
        event.preventDefault();
        const formData = new FormData(this);
        socket.send(JSON.stringify({ type: 'addBatchItems', items: formData }));
        $(this).trigger("reset");
    });

    $('#add-more-items').click(() => {
        $('.batch-inputs').append(`
            <div class="batch-row">
                <input type="text" name="name[]" placeholder="Name" required>
                <input type="number" name="price[]" placeholder="Preis (€)" required>
                <input type="number" name="in_stock[]" placeholder="Auf Lager" required>
                <input type="number" name="buyed[]" placeholder="Gekauft für (€)" required>
                <input type="url" name="link[]" placeholder="Link" required>
                <input type="file" name="image[]" accept="image/*">
            </div>
        `);
    });

    $.get('/api/items', function (data) {
        loadItems(data);
    });
});
