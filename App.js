var app = null;

Ext.define('CustomApp', {

	extend: 'Rally.app.App',

	componentCls: 'app',

	// items:{ html:'<a href="https://help.rallydev.com/apps/2.0rc3/doc/">App SDK 2.0rc3 Docs</a>'},

	launch: function() {
		app = this;
		app.queryIterations();
	},

	getSettingsFields: function() {
        var values = [
            {
                name: 'commitAcceptRatio',
                xtype: 'rallytextfield',
                label : "Target accepted .v. committed percent"
            },
            {
                name: 'continuousImprovementRangeMin',
                xtype: 'rallytextfield',
                label: 'Continuous Improvement Range Min'
            },
            {
                name: 'continuousImprovementRangeMax',
                xtype: 'rallytextfield',
                label: 'Continuous Improvement Range Max'
            }

        ];
        return values;
    },

    config: {
        defaultSettings : {
            commitAcceptRatio : 75,
            continuousImprovementRangeMin : 5,
            continuousImprovementRangeMax : 10
        }
    },

	/*
		queryIteration retrieves all iterations in scope that ended before today and after one
		year ago.
	*/
	queryIterations : function() {
		var today = new Date();
		var lastYear = new Date();
		lastYear.setDate(today.getDate()-365);
		var todayISO = Rally.util.DateTime.toIsoString(today, false);
		var lastYearISO = Rally.util.DateTime.toIsoString(lastYear, false);

		var configs = [
			{
				model  : "Iteration",
				fetch  : ['Name', 'ObjectID', 'Project', 'StartDate', 'EndDate' ],
				filters: [
					{ property : 'EndDate', operator: "<=", value: todayISO },
					{ property : 'EndDate', operator: ">=", value: lastYearISO }
				],

				sorters: [
					{
						property: 'EndDate',
						direction: 'ASC'
					}
				]
			}
		];

		async.map( configs, app.wsapiQuery, function(error,results) {
		/*
			We group the iterations by project (team), and then get metrics for the last four iterations
			for each team.
		*/
			var iterationsRaw = results[0];
			var prjRefs = _.map(results[0],function(iter)
			{
							return iter.get("Project").ObjectID;
			});
			var uniqPrjRefs = _.uniq(prjRefs);

			var querConfigs = _.map(uniqPrjRefs,function(p) {
				return{
					model:"Project",
					fetch: ["TeamMembers"],
					filters: [{property:"ObjectID",value:p}]
				};
			});

			async.map(querConfigs, app.wsapiQuery, function(err, results) {
				var flatTM = _.flatten(results);
				var flatNotEmptyTM = _.filter(flatTM, function(prj) { return prj.get("TeamMembers").Count > 0; });
				var uniqPrjIdTM = _.map(flatNotEmptyTM, function(val) {
								return val.get("ObjectID");
				});

				var inerNoEmptyTM = _.filter(iterationsRaw, function(iter) { return _.contains(uniqPrjIdTM, iter.get("Project").ObjectID );});

				var groupedByProject = _.groupBy(inerNoEmptyTM,function(r) { return r.get("Project").Name;});
				var teams = _.keys(groupedByProject);
				var teamLastIterations = _.map( _.values(groupedByProject), function(gbp) {
								return _.last(gbp,4);
				});          

				/*
				Get the iteration data for each set of up to 4 iterations.
				*/

				async.map( teamLastIterations, app.teamData, function(error,results) {
					app.teamResults = _.map(results, function(result,i) {
						return {
							team : teams[i],
							summary : _.merge(results[i][0],results[i][1],results[i][2])
						};
					});
					// create the table with the summary data.
					app.addTable(app.teamResults);
				});
			});
		});
	},


    /*
        Called for each team to return the iteration and improvements data records
    */
    teamData : function( iterations, callback) {
        app.iterationsData( iterations, function(x,iterationResults) {
            app.improvementsData( iterations,function(err,improvementResults) {
            	app.allIterationItems( iterations, function(err,allIterationItems) {
            		callback(null,[iterationResults,improvementResults,allIterationItems]);	
            	})
            });
        });
    },

    allIterationItems : function( iterations, callback) {

        var configs = _.map( iterations, function(iteration) {
			return {
				model  : "HierarchicalRequirement",
				fetch  : ['ObjectID','PlanEstimate','Name','FormattedID','Project','ScheduleState'],
				filters: [ {
						property : 'Iteration.ObjectID',
						operator: "=",
						value: iteration.get("ObjectID")
					}
				]
			};
		});

		async.map( configs, app.wsapiQuery, function(error,results) {
			var allData = [];
			_.each(results,function(allStories) {
				var allIterationData = {
					totalScope : _.reduce(allStories, function(memo,r) {
						return memo + (r.get("PlanEstimate")!==null  ? r.get("PlanEstimate") : 0)
					},0),
					lateAccepted : _.reduce(allStories, function(memo,r) {
						return memo + app.acceptedValue(r);
					},0)
				}
				allData.push(allIterationData);
			});				
			callback(null,allData);
		});
    },

    improvementsData : function( iterations, callback) {

        var configs = _.map( iterations, function(iteration) {
			return {
				model  : "HierarchicalRequirement",
				fetch  : ['ObjectID','PlanEstimate','Name','FormattedID','Project','ScheduleState'],
				filters: [ {
						property : 'Feature.Name',
						operator: "contains",
						value: 'Continuous Improvement'
					},
					{
						property : 'Iteration.ObjectID',
						operator: "=",
						value: iteration.get("ObjectID")
					},
					{
						property : 'ScheduleState',
						operator: "=",
						value: "Accepted"
					}
				]
			};
		});

		async.map( configs, app.wsapiQuery, function(error,results) {
			var allData = [];
			_.each(results,function(result){
				var improvementRec = {
					totalImprovementPoints : _.reduce(result,function(memo,r){
						return memo + app.acceptedValue(r);
					},0)
				}
				allData.push(improvementRec);
			});
			
			callback(null,allData);
		});

    },

    acceptedValue : function(story) {
		var accepted = story.get("ScheduleState") === "Accepted" || story.get("ScheduleState") == "Released";
		var val = accepted && (story.get("PlanEstimate")!==null) ? story.get("PlanEstimate") : 0;
		return val;
    },

	/*
		Retrieves the iteration metrics (iterationcumulativeflowdata) for each set of iterations
	*/
	iterationsData : function( iterations, callback) {
		// create a set of wsapi query configs from the iterations

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

		// once we have the metrics data we do some gymnastics to calculate the committed and accepted values
		async.map( configs, app.wsapiQuery, function(error,results) {
			var summaries = [];
			_.each(results,function(iterationRecords, index) {
				if(iterationRecords.length >0) {
					// group the metrics by date,
					var groupedByDate = _.groupBy(iterationRecords,function(ir) { return ir.get("CreationDate");});

					var churnRatio = app.churnRatio(_.values(groupedByDate));
					var iterationDates = _.keys(groupedByDate);
					iterationDates = _.sortBy(iterationDates,function(d) {
						return Rally.util.DateTime.fromIsoString(d);
					});
					var firstDayRecs = groupedByDate[_.first(iterationDates)];
					var lastDayRecs = groupedByDate[_.last(iterationDates)];
					if((firstDayRecs.length>0) && (lastDayRecs.length>0))
					{
						var committed = _.reduce( firstDayRecs, function(memo,val) {
										return memo + (val.get("CardEstimateTotal") !== null ? val.get("CardEstimateTotal") : 0);
						}, 0 );
						var accepted = _.reduce( lastDayRecs, function(memo,val) {
							var estimate = val.get("CardEstimateTotal");
							var done = val.get("CardState") === "Accepted" || val.get("CardState") === "Released";
							return memo + ( done && !_.isNull(estimate) ) ? estimate : 0;
						}, 0 );
						summaries.push( {
							project : iterations[index].get("Project"),
							iteration : iterations[index].get("Name"),
							id : firstDayRecs[0].get("IterationObjectID"),
							committed : Math.round(committed),
							accepted : Math.round(accepted),
							churnRatio : churnRatio
						});
					};
				}
			});
			callback(null,summaries);
		});
	},

	addTable : function(teamResults) {
		var grid = Ext.create('Rally.ui.grid.Grid', {
			store: Ext.create('Rally.data.custom.Store', {
				data: teamResults
			}),
			columnCfgs: [
				{ text: 'Team', dataIndex: 'team' },
				{ text: 'Last 4 Sprints', dataIndex: 'summary', renderer : app.renderSummaries, width : 200 },
				{ text: '% Accepted Chart', dataIndex: 'summary', renderer : app.renderAcceptedChart,width : 150, align : "center" },
				{ text: '% Improvement Chart', dataIndex: 'summary', renderer : app.renderImprovementChart,width : 150, align : "center" },
				{ text: 'Churn Ratio Chart', dataIndex: 'summary', renderer : app.renderChurnChart,width : 150, align : "center" }
			]
		});
		app.add(grid);
	},

	// Returns the std dev when passed an array of arrays of daily cumulative flow recs
	churnRatio : function ( arrDailyRecs ) {

		var dailyTotals = _.map( arrDailyRecs, function(recs) {
			return _.reduce(recs,function(memo,r) { return memo + r.get("CardEstimateTotal");},0)
		});
		var dailyAverage = _.mean(dailyTotals);
		var stdDev = _.stdDeviation(dailyTotals);
		return dailyAverage > 0 ? Math.round((stdDev / dailyAverage) *100) : 0;

	},

	renderAcceptedChart: function(value, metaData, record, rowIdx, colIdx, store, view) {
		var data = _.map( value, function (v,i) {
			var drec =  {
				acceptedPercent : v.committed > 0 ? Math.round((v.accepted / v.committed) * 100) : 0,
				targetPercent : app.getSetting("commitAcceptRatio"),
				index : i+1
			};
			return drec;
		});



		record.chartStore = Ext.create('Ext.data.JsonStore', {
			fields: ['index','acceptedPercent','targetPercent'],
			data: data
		});

		record.chartConfig = {
			style : {
				// backgroundColor : 'red'
			},
			width: 100,
			height: 100,
			axes: [{
				type: 'Numeric',
				position: 'left',
				fields: ['acceptedPercent'],
				label: {
					renderer: Ext.util.Format.numberRenderer('0,0')
				},
				grid: true
			}, {
				type: 'Category',
				position: 'bottom',
				fields: ['index']
			}],
			series: [
				{
					type: 'line',
					highlight: {
						size: 2,
						radius: 2
					},
					axis: 'left',
					xField: 'index',
					yField: 'acceptedPercent'
				},
				{
					type: 'line',
					style: {
		                //stroke: "red"
		                stroke: '#ff0000',
		                fill: '#ff0000'
		            },
		            markerConfig: { 
    	                type: 'circle',
		                size: 1,
                		radius: 1,
					},
					axis: 'left',
					xField: 'index',
					yField: 'targetPercent'
				}
			]
		};

		var id = Ext.id();
		Ext.defer(function (id) {
			record.chartConfig.renderTo = id;
			record.chartConfig.store = record.chartStore;
			// record.chartConfig.style.backgroundColor = "yellow";	
			if (record.chart===undefined)
				record.chart = Ext.create('Ext.chart.Chart', record.chartConfig);
		}, 50, undefined, [id]);

		var prj = value[0].project.ObjectID;
		var iteration = _.last(value).id;
		var href = "https://rally1.rallydev.com/#/"+prj+"/oiterationstatus?iterationKey="+iteration;
		return "<a id='" + id + "'href="+href+" target=_blank></a>";
	},

	renderImprovementChart: function(value, metaData, record, rowIdx, colIdx, store, view) {
		var data = _.map( value, function (v,i) {
			var drec =  {
				improvementPercent : v.totalScope > 0 ? Math.round((v.totalImprovementPoints / v.totalScope) * 100) : 0,
				index : i+1
			};
			return drec;
		});

		record.improvementChartStore = Ext.create('Ext.data.JsonStore', {
			fields: ['index','improvementPercent'],
			data: data
		});

		record.improvementChartConfig = {
			width: 100,
			height: 100,
			axes: [{
				type: 'Numeric',
				position: 'left',
				fields: ['improvementPercent'],
				label: {
					renderer: Ext.util.Format.numberRenderer('0,0')
				},
				grid: true
			}, {
				type: 'Category',
				position: 'bottom',
				fields: ['index']
			}],
			series: [
				{
					type: 'line',
					highlight: {
						size: 2,
						radius: 2
					},
					axis: 'left',
					xField: 'index',
					yField: 'improvementPercent'
				}
			]
		};

		var id = Ext.id();
		Ext.defer(function (id) {
			record.improvementChartConfig.renderTo = id;
			record.improvementChartConfig.store = record.improvementChartStore;
			if (record.improvementChart===undefined)
				record.improvementChart = Ext.create('Ext.chart.Chart', record.improvementChartConfig);
		}, 50, undefined, [id]);

		return "<div id='"+id+"'></div>";
	},

	renderChurnChart: function(value, metaData, record, rowIdx, colIdx, store, view) {
		var data = _.map( value, function (v,i) {
			return {
				churnRatio : v.churnRatio,
				index : i+1
			};
		});

		record.churnChartStore = Ext.create('Ext.data.JsonStore', {
			fields: ['index','churnRatio'],
			data: data
		});

		record.churnChartConfig = {
			width: 100,
			height: 100,
			axes: [{
				type: 'Numeric',
				position: 'left',
				fields: ['churnRatio'],
				label: {
					renderer: Ext.util.Format.numberRenderer('0,0')
				},
				grid: true
			}, {
				type: 'Category',
				position: 'bottom',
				fields: ['index']
			}],
			series: [
				{
					type: 'line',
					highlight: {
						size: 2,
						radius: 2
					},
					axis: 'left',
					xField: 'index',
					yField: 'churnRatio'
				}
			]
		};

		var id = Ext.id();
		Ext.defer(function (id) {
			record.churnChartConfig.renderTo = id;
			record.churnChartConfig.store = record.churnChartStore;
			if (record.churnChart===undefined)
				record.churnChart = Ext.create('Ext.chart.Chart', record.churnChartConfig);
		}, 50, undefined, [id]);

		return "<div id='"+id+"'></div>";
	},

	LinkRenderer: function(value, metaData, record, rowIdx, colIdx, store, view) {
		var workspace=app.getContext().getProject().ObjectID;
		var lastSprintId= _.last(value).id;
		return "<a href='https://rally1.rallydev.com/#/"+workspace+"/oiterationstatus?iterationKey="+lastSprintId+"' target='_blank'>Last one</a>";
	},

	renderSummaries: function(value, metaData, record, rowIdx, colIdx, store, view) {
		return "<table class='iteration-summary'>" +
			"<tr>" +
			"<td>Committed</td>" +
			"<td>" + value[0].committed + "</td>" +
			"<td>" + value[1].committed + "</td>" +
			"<td>" + value[2].committed + "</td>" +
			"<td>" + value[3].committed + "</td>" +
			"</tr>" +
			"<tr>" +
			"<td>Accepted</td>" +
			"<td>" + value[0].accepted + "</td>" +
			"<td>" + value[1].accepted + "</td>" +
			"<td>" + value[2].accepted + "</td>" +
			"<td>" + value[3].accepted + "</td>" +
			"</tr>" +
			"</table>";
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