var app = null;

Ext.define('CustomApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',
    items:{ html:'<a href="https://help.rallydev.com/apps/2.0rc3/doc/">App SDK 2.0rc3 Docs</a>'},
    launch: function() {
        //Write app code here
        app = this;
		app.store = Ext.create('Ext.data.JsonStore', {
        fields: ['name', 'data1', 'data2', 'data3', 'data4', 'data5'],
        data: [{
            'name': 'metric one',
            'data1': 10,
            'data2': 12,
            'data3': 14,
            'data4': 8,
            'data5': 13
        }, {
            'name': 'metric two',
            'data1': 7,
            'data2': 8,
            'data3': 16,
            'data4': 10,
            'data5': 3
        }, {
            'name': 'metric three',
            'data1': 5,
            'data2': 2,
            'data3': 14,
            'data4': 12,
            'data5': 7
        }, {
            'name': 'metric four',
            'data1': 2,
            'data2': 14,
            'data3': 6,
            'data4': 1,
            'data5': 23
        }, {
            'name': 'metric five',
            'data1': 4,
            'data2': 4,
            'data3': 36,
            'data4': 13,
            'data5': 33
        }]
    });
	
	
	app.chartConfig= {
        //renderTo: Ext.getBody(),
        width: 100,
        height: 100,
        animate: true,
        store: app.store,
        axes: [{
            type: 'Numeric',
            position: 'left',
            fields: ['data1', 'data2'],
            label: {
                renderer: Ext.util.Format.numberRenderer('0,0')
            },
            
            grid: true,
            minimum: 0
        }, {
            type: 'Category',
            position: 'bottom',
            fields: ['name']
            
        }],
        series: [{
            type: 'line',
            highlight: {
                size: 7,
                radius: 7
            },
            axis: 'left',
            xField: 'name',
            yField: 'data1',
            markerConfig: {
                type: 'cross',
                size: 1,
                radius: 2,
                'stroke-width': 0
            }
        }]
    };
        app.queryIterations();
    },

    queryIterations : function() {

        var configs = [
            {
                model  : "Iteration",
                fetch  : ['Name', 'ObjectID', 'Project', 'StartDate', 'EndDate' ],
                filters: [ Ext.create('Rally.data.wsapi.Filter', {
                    property : 'EndDate', 
                    operator: "<=", 
                    value: Rally.util.DateTime.toIsoString(new Date(), false)
                })],
                sorters: [
                    {
                        property: 'EndDate',
                        direction: 'ASC'
                    }
                ]
            }
        ];

        async.map( configs, app.wsapiQuery, function(error,results) {

            console.log(results);

            var eds = _.map( results[0], function(x) { return x.get("EndDate")});

            console.log( _.last(eds,4));

            // console.log("Iteration Results", _.last(_.map(results[0],function(x) { return x.get("EndDate")}),4));
            var last4iterations = _.last(results[0],4);

            app.iterationData( last4iterations, function(error,results){

                // 
                console.log("iteration data",results);

            });



        })
    },

    iterationData : function( iterations, callback) {

        var configs = _.map( iterations, function(iteration) {
            return {

                model  : "IterationCumulativeFlowData",
                fetch  : ['CardEstimateTotal','CardState','CreationDate'],
                filters: [ Ext.create('Rally.data.wsapi.Filter', {
                    property : 'IterationObjectID', 
                    operator: "=", 
                    value: iteration.get("ObjectID")
                })]
            };
        });

        console.log("Configs:",configs);

        async.map( configs, app.wsapiQuery, function(error,results) {

            var summaries = [];

            _.each(results,function(iterationRecords, index){ 

                var groupedByDate = _.groupBy(iterationRecords,function(ir) { return ir.get("CreationDate")});

                // console.log(groupedByDate);
                var iterationDates = _.keys(groupedByDate);
                iterationDates = _.sortBy(iterationDates,function(d) {
                    return Rally.util.DateTime.fromIsoString(d);
                });
                // console.log(iterationDates);
                var firstDayRecs = groupedByDate[_.first(iterationDates)];
                var lastDayRecs = groupedByDate[_.last(iterationDates)];

                console.log("first",firstDayRecs);
                console.log("last",lastDayRecs);

                var committed = _.reduce( firstDayRecs, function(memo,val) { 
                    return memo + (val.get("CardEstimateTotal") !== null ? val.get("CardEstimateTotal") : 0);
                }, 0 );

                var accepted = _.reduce( lastDayRecs, function(memo,val) { 

                    var estimate = val.get("CardEstimateTotal");
                    var done = val.get("CardState") === "Accepted" || val.get("CardState") === "Released";

                    return memo + ( done && !_.isNull(estimate) ) ? estimate : 0;
                }, 0 );

                summaries.push( { 

                    iteration : iterations[index].get("Name"),
                    id : iterations[index].get("ObjectID"),
                    committed : committed,
                    accepted : accepted

                });
            })

            console.log("summaries",summaries);

            app.addTable(summaries);

        });

    },

    addTable : function(summaries) {

        var grid = Ext.create('Rally.ui.grid.Grid', {
            store: Ext.create('Rally.data.custom.Store', {
                data: [ {
                    "summaries" : summaries
                }
                ]
            }),
            columnCfgs: [
                {
                    text: 'Last 4 Sprints', dataIndex: 'summaries', renderer : app.renderSummaries
                },
				{
                    text: 'Last Sprint Link', dataIndex: 'summaries', renderer : app.LinkRenderer
                },
				{
                    text: 'Sparkline', dataIndex: 'summaries', renderer : app.SparklineRenderer
                }
            ]
        });

        app.add(grid);

    },

    renderSummaries: function(value, metaData, record, rowIdx, colIdx, store, view) {
        console.log("value",value,record);
        return "<table height=200>" + 
            "<tr>" + 
            "<td>" + value[0].committed + "</td>" +
            "<td>" + value[1].committed + "</td>" +
            "<td>" + value[2].committed + "</td>" +
            "<td>" + value[3].committed + "</td>" +
			
            "</tr>" +
            "<tr>" + 
            "<td>" + value[0].accepted + "</td>" +
            "<td>" + value[1].accepted + "</td>" +
            "<td>" + value[2].accepted + "</td>" +
            "<td>" + value[3].accepted + "</td>" +
            "</tr>" +
            "</table>";
    },

	LinkRenderer: function(value, metaData, record, rowIdx, colIdx, store, view) {
        console.log("value",value,record);
		var workspace=app.getContext().getProject().ObjectID;
		
		var lastSprintId= _.last(value).id;
		console.log("workspace=",workspace, "lastSid=", lastSprintId);
        return "<a href='https://rally1.rallydev.com/#/"+workspace+"/oiterationstatus?iterationKey="+lastSprintId+"' target='_blank'>Last one</a>";
    },
	SparklineRenderer: function(value, metaData, record, rowIdx, colIdx, store, view) {

        var id = Ext.id();
        Ext.defer(function (id) {
            app.chartConfig.renderTo = id;
            var chart = Ext.create('Ext.chart.Chart', app.chartConfig);
        }, 50, undefined, [id]);

        return "<div id='" + id + "'></div>";
    },

	
    wsapiQuery : function( config , callback ) {

        Ext.create('Rally.data.WsapiDataStore', {
            autoLoad : true,
            limit : "Infinity",
            model : config.model,
            fetch : config.fetch,
            filters : config.filters,
            sorters : config.sorters,
            listeners : {
                scope : this,
                load : function(store, data) {
                    callback(null,data);
                }
            }
        });

    }


});
